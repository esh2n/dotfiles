---
question: "In 2026 industry practice, who owns the coding-agent sandbox boundary — the harness itself, a cross-tool spec, a runtime platform, or a separate harness-independent selection layer?"
date: 2026-09-22
verdict: "Sandboxing is harness-native by a wide margin (Claude Code, Codex, and Gemini CLI each ship and default to their own sandbox); devcontainer.json is the recognized cross-tool escape valve, endorsed by Anthropic and independently converged on by practitioners, for standardizing one boundary across several harnesses; a genuinely harness-independent layer that inspects which harness is about to run and selects a different isolation mechanism for it has no established industry precedent."
unverified:
  - "DSH's own sandbox mechanism — no public documentation was reachable, excluded from the cross-tool cross-check"
  - "OWASP GenAI/LLM Top 10's specific stance on who should own the sandbox boundary — pages could not be loaded (truncated card, 404s), a fetch failure not a documented absence"
  - "Gemini CLI's sandbox docs were confirmed only via a GitHub repo file (docs/cli/sandbox.md), not cross-checked against a rendered docs site"
  - "no real-world example found of a layer that dynamically selects a different isolation mechanism per harness or per run — only uniform-policy wrappers (ai-bwrap, ai-jail) exist"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Who owns the coding-agent sandbox boundary — industry practice, 2026

Scope: this is a survey of *public* precedent for angles 1-5 below. It does not
evaluate or reference any tool the requester owns. WebSearch was exhausted for
this session (200/200 quota used before any query returned results) — every
finding below comes from `WebFetch` against primary docs/READMEs and `gh`
(GitHub CLI, authenticated) repo/README search. Where a source could not be
reached (HTTP 404, blocked, or paywalled), it is flagged **[unverified]**.

---

## 1. Harness-native sandboxes

**Claude Code.** Three isolation tiers, all first-party, are documented at
`code.claude.com/docs/en/sandbox-environments`:

- **Sandboxed Bash tool** — Seatbelt (macOS) / bubblewrap (Linux/WSL2),
  restricts only Bash/PowerShell/Monitor commands, configured with `/sandbox`
  and `sandbox.*` settings keys.
- **Sandbox runtime** (`@anthropic-ai/sandbox-runtime`, "srt") — wraps the
  *whole* Claude Code process (file tools, MCP servers, hooks too), beta,
  configured via `~/.srt-settings.json`.
- Dev container / custom container / VM / cloud session (see §2).

Crucially, the docs state explicitly which of these an *external* actor can
enforce, and how:

> "**Built-in Bash sandbox**: the only approach Claude Code enforces itself.
> Deliver the `sandbox` settings keys through managed settings, either as a
> file managed by your MDM or through server-managed settings on Claude.ai."
>
> "**Dev containers**: commit the example dev container to your repositories
> to standardize the environment across a team. This is a convention rather
> than an enforcement boundary, because Claude Code does not require a
> container. If developers should not be able to run Claude Code outside it,
> enforce that with your organization's device management or software
> allowlisting tools."
>
> "**Custom containers and VMs**: distribute Claude Code through the approved
> image and use your organization's device management or software
> allowlisting tools to prevent installation outside it."

So there **is** a documented admin/platform role — but it is narrow and
tiered: (a) push `sandbox.*` config values via `managed-settings.json` /
MDM / claude.ai server-managed settings (highest-precedence tier in the
settings hierarchy — `Managed settings > CLI flags > project-local >
shared-project > user`); (b) certain sandbox keys
(`sandbox.network.tlsTerminate`, `sandbox.credentials`,
`sandbox.enableWeakerNestedSandbox`, `sandbox.filesystem.disabled`, etc.) are
explicitly flagged as needing a user-facing security-approval dialog before
they take effect — the client, not the pusher, still adjudicates. (c) Claude
Code's own docs are explicit that this is a "client-side control, not a
security boundary": "On unmanaged devices, a user doesn't need admin or sudo
access to bypass them." Enforcement of *container/VM-only usage* is
delegated out to generic MDM/allowlisting, not to Claude Code itself.

**Codex CLI.** `sandbox_mode` (`read-only` / `workspace-write` /
`danger-full-access`) is set in `~/.codex/config.toml` or project-level
`.codex/config.toml`, overridable by CLI flags/`--profile`, and paired with a
separate `approval_policy` axis (`on-request`/`never`/...). Org control
exists and is explicit:

> "On managed machines, your organization may also enforce constraints via
> `requirements.toml`" — a `guardian_policy_config` can be centrally managed
> and "takes precedence" over local policy text; project-scoped config
> "can't override machine-local provider, auth, ... or telemetry routing
> keys," and administrator-managed `experimental_network` requirements can
> force the network proxy that enforces domain rules. There are also
> "Cloud-managed config.toml defaults" in the precedence stack.

So Codex has the same shape as Claude Code: a native `sandbox_mode`
mechanism, configurable per-user/per-project, with a documented but narrow
org-override channel (`requirements.toml`) layered on top by the vendor
itself — not by an external third-party tool.

**Gemini CLI.** Sandbox is native and multi-backend: Seatbelt (macOS,
`sandbox-exec`), Docker/Podman (cross-platform), gVisor/`runsc` and LXC/LXD
(Linux), native Windows via `icacls`. Configured via `-s/--sandbox` flag,
`GEMINI_SANDBOX` env var, or `settings.json` under `tools`. **No mention of
devcontainers, VS Code remote containers, or any external selection tool** —
Gemini CLI documents itself as owning sandbox selection entirely within its
own config surface. **[Note: I could not load Gemini CLI's canonical docs
site; this is from the `docs/cli/sandbox.md` file in the `google-gemini/gemini-cli`
GitHub repo, which is primary-source but I did not cross-check against a
rendered docs site — treat as verified-but-single-source.]**

**DSH.** No public documentation was reachable for a "dsh-sandbox" — this
appears to be a private/internal harness with no public docs indexed;
**[unverified / not publicly documented]**, excluded from the cross-check
below.

**Cross-tool pattern for angle 1:** all three public harnesses checked
(Claude Code, Codex, Gemini CLI) ship sandboxing as a **first-party,
harness-native feature**, configured primarily through the harness's own
settings surface. All three also document a narrow **vendor-provided
admin/platform override channel** (Claude Code: managed-settings.json /
MDM / claude.ai server-managed settings; Codex: `requirements.toml` /
cloud-managed config.toml defaults) — but in every case this channel is
built and owned by the harness vendor itself, delivering *values into that
harness's own sandbox config schema*. None of the three documents a
mechanism for a **third-party, harness-independent tool** to select or swap
in a different sandbox mechanism on the harness's behalf. The admin layer
picks values within the harness's own schema; it does not replace the
harness's sandbox implementation.

---

## 2. Cross-tool environment specs (devcontainer)

`containers.dev` describes itself as "An open specification for enriching
containers with development specific content and settings," explicitly
positioned as tool-agnostic (works across "a variety of supporting tools and
editors" — VS Code, GitHub Codespaces, JetBrains IDEs, the standalone
`devcontainer` CLI, per the spec's own "Supporting Tools" reference).

Anthropic's own docs (`code.claude.com/docs/en/devcontainer`) treat the dev
container as **the recommended path for standardizing sandboxing across a
team**, and are explicit that Claude Code is a *guest* inside it, not the
thing defining it:

> "A development container ... lets you define an identical, isolated
> environment that every engineer on your team can run. With Claude Code
> installed in that container, commands Claude runs execute inside it rather
> than on the host machine..."
>
> "The settings work with any tool that supports the Dev Containers spec,
> such as VS Code, GitHub Codespaces, or JetBrains IDEs."

Claude Code installs into the devcontainer via a published **Dev Container
Feature** (`ghcr.io/anthropics/devcontainer-features/claude-code`) — the
same mechanism any devcontainer-spec tool uses to add capabilities, not a
Claude-specific hook. The `sandbox-environments` comparison page explicitly
ranks devcontainer above the native Bash sandbox for "Standardize a
sandboxed environment across a team" and for unattended/`--dangerously-skip-permissions`
runs (because it's the one approach that puts file tools, MCP servers, and
hooks inside the boundary too, not just Bash).

I found no equivalent first-party devcontainer doc for Codex CLI or Gemini
CLI (Gemini CLI's own docs make no mention of devcontainers at all — see
§1). So: **devcontainer is a genuinely cross-tool, vendor-neutral spec**, and
Anthropic explicitly recommends it as the team-standardization answer for
Claude Code — but it is not (yet, in what I could verify) documented by the
other vendors as *their* recommended isolation path. Its cross-harness use
in the wild is a **practitioner pattern** (see §4), not a vendor-declared
standard across all harnesses.

---

## 3. Agent-runtime platforms — positioning quotes

| Product | Positioning (quoted) | Layer |
|---|---|---|
| **E2B** | "E2B is the AI agent cloud. It gives each agent session an isolated Linux machine that boots from a snapshot and works with any model or agent framework." / "Bring your own model, prompts, agent harness, and orchestration framework. E2B supplies the machine where the agent acts." | Platform the agent runs **inside**; framework-agnostic by design, but it is *your app's* SDK call that creates the sandbox — not an external tool watching a harness and choosing isolation for it. |
| **Daytona** | "Secure and Elastic Infrastructure for Running Your AI-Generated Code." / "The Runtime AI Agents Actually Need." | Same shape as E2B: infrastructure an agent's code runs inside, invoked programmatically. |
| **Docker Sandboxes (`sbx`)** | Isolated microVM sandboxes where "the agent can build containers, install packages, and modify files without accessing host resources beyond those you share." Docs example: `sbx run claude`. | A VM/container product a *single* tool is pointed at per invocation. No mention found of coordinating or selecting between multiple different agent CLIs; it's the mechanism Claude Code's own docs cite for the VM tier (`docs.docker.com/ai/sandboxes/`), i.e. Claude Code treats it as one of several interchangeable hosts, not the other way around. |
| **AWS Bedrock AgentCore Runtime** | "Start with LangChain, OpenAI Agents SDK, Claude Agent SDK, Strands SDK, or your own framework, and deploy with any model." "Security controls are enforced at the platform layer." | Multi-framework-agnostic deployment platform with **uniform** platform-level security — no evidence of per-agent/per-run differentiated isolation selection. |
| **Cloudflare Sandbox SDK** | "run untrusted code securely in isolated environments," "Each sandbox runs in its own isolated container with a full Linux environment." No mention of Claude Code/Codex specifically — ties into Cloudflare's own Workers AI ecosystem. | Runtime platform, not a cross-harness selector. |
| **`@anthropic-ai/sandbox-runtime` (srt)** | "A lightweight sandboxing tool for enforcing filesystem and network restrictions on arbitrary processes at the OS level, without requiring a container." "It can be used to sandbox the behaviour of agents, local MCP servers, bash commands and arbitrary processes." "developed for Claude Code ... made available as an early open source preview to help the broader ecosystem build more secure agentic systems." | Explicitly general-purpose OS-level wrapper (Seatbelt/bubblewrap), built by Anthropic but explicitly **not** scoped to Claude Code only — the closest a vendor product comes to "harness-independent wrapper," but it does not itself contain per-harness selection logic; you invoke it (`npx @anthropic-ai/sandbox-runtime claude`) around whatever binary you name. |

**No runtime platform surveyed positions itself as "the thing that decides,
per harness or per run, which isolation to apply."** Every one of them is
either (a) infrastructure an app/agent targets via SDK calls that *your*
code decides to make, or (b) a generic process wrapper you invoke manually
per-command. The "decide which isolation for which harness" logic, where it
exists at all, lives in whatever script/config invokes these products — not
in the products themselves.

---

## 4. Practitioner practice (GitHub repos, `gh search`)

`gh search repos "claude code" "codex" sandbox devcontainer` and follow-up
searches surfaced a consistent, real pattern — teams/individuals running
**multiple** coding-agent CLIs converge on **one shared devcontainer/container
image that every harness runs inside**, occasionally layered with a
harness-independent OS-level wrapper script:

- **`stefanoginella/aicontainer`** — "Sandboxed devcontainer for running
  Claude Code, Codex, and OpenCode in bypass/auto-approve mode." Notably,
  it goes one step further than "just a shared container": it also
  implements **one shared enforcement hook across all three CLIs**:
  > "One script (`/etc/aic/hooks/pre-tool-use.sh`) is the single source of
  > truth for all three tools: Claude registers it in `settings.json`, Codex
  > via a managed hook, and OpenCode via a small plugin."
  Rationale: "Auto-approve is the only way these CLIs actually fly — but
  pointed at your real `$HOME` it also lets a prompt-injected dependency
  read `.env`, exfiltrate shell history, or push through your `gh` token."
  This is the single clearest public precedent for "one policy layer,
  wired into each harness's own native extension point (settings.json hook
  / managed hook / plugin), enforcing the same rule across harnesses" —
  but note it still relies on the *devcontainer* for the actual OS/filesystem
  isolation boundary; the shared script is defense-in-depth policy, not the
  sandbox itself.
- **`morimorijap/sunaba-cli`** — "One-command devcontainer sandbox CLI for
  AI agent development (Claude Code / Codex / Gemini CLI)." Rationale: "AI
  coding agents are powerful but messy: they install global packages, fetch
  random scripts, and mutate your machine in surprising ways" → one
  disposable per-project Linux container, all three CLIs preinstalled,
  agents can even call each other via a shared `.mcp.json`.
- **`EltonAU/devcontainers`** — "Reusable VS Code devcontainer templates
  for sandboxed Claude Code + Codex workflows."
- **`hildstrom/apple-devcontainer`** — runs Claude Code and Codex CLI
  "sandboxed in a disposable development container."
- **`av-k/devenv`** — "Disposable, network-restricted sandbox for coding
  agents — Claude Code, Codex CLI and Antigravity CLI in an isolated
  container."

Separately, a **non-devcontainer, harness-independent wrapper** pattern
exists too, smaller and more artisanal:

- **`didvc/ai-bwrap`** — "Run AI coding agents inside a bubblewrap sandbox —
  one wrapper, any agent." Agents (`claude`, `opencode`, `grok`, custom via
  `agent_<name>` shell functions) are declared as small registry entries;
  the wrapper applies **one uniform bwrap policy** (cwd read-write, `$HOME`
  hidden except passed-through config dirs, PID namespace, no setuid) to
  whichever binary you name. It is explicitly framed as the sequel to a
  single-tool version (`opencode-bwrap`) generalized to be harness-agnostic.
- **`akitaonrails/ai-jail`** — Rust CLI: bubblewrap + Landlock + seccomp on
  Linux, `sandbox-exec` on macOS, explicitly not tied to one agent
  (`ai-jail claude`, presumably others). Explicit humility: "It is a useful
  layer, not a replacement for a disposable VM when running hostile code."
  Secure-by-default: agent credential state is *not* mounted unless
  `--agent-state <name>` is passed.
- **`seznam/jailoc`** — "sandboxed Docker environments with network
  isolation for Opencode agents" (single-harness, Docker-based; adjacent
  pattern).

**Synthesis for §4:** the dominant practitioner pattern for "I run more than
one coding-agent CLI and want them sandboxed" is **one shared
devcontainer/container image all harnesses run inside** — i.e., practitioners
independently converge on the same answer Anthropic's own docs recommend
(§2), just generalized to more than one harness. A smaller, more
niche pattern is a **generic OS-level wrapper script** (bubblewrap/Landlock)
applied uniformly to whichever agent binary you invoke — this is the closest
real-world artifact to "harness-independent sandbox-selection layer," but
even these apply **one fixed policy to everything**, they do not *select
different isolation per harness or per run* based on some evaluation of the
harness's own risk profile. I found zero real-world examples of a layer that
inspects which harness is about to run and dynamically chooses a different
isolation mechanism for it.

---

## 5. Security/architecture guidance on where the boundary should live

- **Anthropic's Claude Code docs** (§1, §2) are unusually explicit and
  consistent on this: sandboxing is native-per-harness by default; an
  external admin layer may **push config values into that native
  mechanism** (managed settings / MDM) but Claude Code's own security docs
  call that "a client-side control, not a security boundary" on unmanaged
  devices. The stronger boundary they recommend for teams is the
  devcontainer/VM tier — again, something the harness runs *inside*, not
  something that watches and wraps the harness from outside.
- **Anthropic's "CISO's guide to agentic AI"** (linked from the Security
  page) frames it as a shared responsibility across two layers, not one:
  platform-level isolation ("the environment the agent loop runs in should
  never hold a credential worth stealing" — Claude Cowork's agent loop runs
  "in an isolated, temporary sandbox on Anthropic-managed infrastructure,"
  with connector tokens kept out of the sandbox via a reverse proxy) *plus*
  org-defined policy ("Decide your trust boundary. Write down what counts
  as untrusted content in your environment") enforced through org-wide
  toggles, RBAC, and per-connector restrictions. Bottom line stated in the
  guide: sandbox boundaries are built into the deployment platform; the
  organization's job is defining and enforcing *reachability* policy on top
  (identity, allowlists, RBAC), not building its own sandbox.
- **OWASP GenAI/LLM Top 10 (Excessive Agency, LLM06:2025)** — **[unverified]**:
  I could not load either `genai.owasp.org/llm-top-10/` (returned only a
  truncated card, no body) or several guessed direct URLs for the LLM06
  Excessive Agency detail page (404s). I could not independently confirm
  OWASP's specific stance on *who* should own the sandbox boundary. Do not
  treat the absence of a quote here as OWASP being silent on the topic —
  it's a fetch failure, not a documented absence, and WebSearch (which
  would normally have found the exact page) was unavailable this session.

---

## Cross-check across angles

All five angles point the same direction:

- Every harness vendor checked (Claude Code, Codex, Gemini CLI) **ships and
  owns its own native sandbox**, configured through that harness's own
  settings surface.
- Where an "admin/platform" role exists, it is a **narrow, vendor-built
  channel that pushes values into that harness's own sandbox schema**
  (Claude Code: managed-settings.json/MDM/server-managed settings; Codex:
  `requirements.toml`/cloud-managed defaults) — never a third party
  replacing or selecting the sandbox mechanism itself.
- **devcontainer.json is the one genuinely cross-tool, vendor-neutral spec**
  in this space, and it's the one *both* the vendor (Anthropic, explicitly)
  and independent practitioners (§4, independently, multiple repos)
  converge on as the answer to "I have more than one thing that needs the
  same isolation."
- **Runtime platforms (E2B/Daytona/Modal/Docker Sandboxes/AgentCore/
  Cloudflare/srt)** are infrastructure a harness runs *inside*, invoked by
  your own code/scripts — none of them contains "pick the right sandbox for
  this harness" logic themselves.
- The only real-world artifacts that are genuinely **harness-independent
  wrapper layers** (`ai-bwrap`, `ai-jail`) exist, are small (personal-scale
  OSS, single maintainer, dozens of stars), and apply **one uniform policy**
  to any agent named on the command line — they do not do *per-harness
  differentiated selection*.

---

## A. Industry answer: who owns the sandbox

**Harness-native, by a wide margin**, with devcontainer as the recognized
cross-tool escape valve for teams that want one definition to standardize
several harnesses under, and runtime platforms as the substrate underneath
either of those when you want VM-grade isolation without operating your own
infra. A separate, harness-independent *selection* layer is not an
established industry pattern — it shows up only as small, single-policy OSS
wrapper scripts, not as a recognized architecture pattern in vendor docs or
security guidance.

Rough distribution of what's actually documented/practiced:
1. **Harness-native (dominant)** — Claude Code, Codex, Gemini CLI all ship
   and default to their own sandbox; this is where 100% of the harnesses
   surveyed start.
2. **Cross-tool spec (devcontainer)** — the recommended way to standardize
   across a *team*, and (per §4) the de facto way practitioners standardize
   across *multiple harnesses*; endorsed explicitly by Claude Code's own
   docs, adopted independently by five-plus practitioner repos for
   multi-harness setups.
3. **Runtime platform** — the substrate under devcontainer/VM-tier options
   (Docker Sandboxes is literally cited in Claude Code's own docs as a
   VM-tier option); invoked by app code or by the harness's own docs, not a
   selector in its own right.
4. **Separate infra/policy layer that only pushes config values** — real,
   but narrow: managed-settings/MDM/server-managed settings (Claude Code)
   and `requirements.toml`/cloud-managed defaults (Codex) let an org set
   *values* in the harness's native sandbox schema. This is policy
   distribution, not sandbox selection or implementation.
5. **Genuinely harness-independent selection/wrapper layer** — the weakest
   attested category: two small OSS wrapper scripts (`ai-bwrap`, `ai-jail`)
   that apply one fixed policy across whichever agent you name; no vendor,
   platform, or security-guidance source frames this as a recommended or
   common pattern.

## B. Precedent for a harness-independent layer that selects/applies the boundary per harness/run

**No clean precedent for the "selects, per harness or per run" part.**
What exists:

- **Closest functioning precedent: `ai-bwrap` / `ai-jail`.** Real,
  public, harness-independent wrapper CLIs. They *apply* one sandbox
  mechanism uniformly to any named agent (bubblewrap+Landlock+seccomp /
  Seatbelt) via a small per-agent registry (bind mounts, env passthrough).
  They do **not** select *different* isolation per harness — every harness
  gets the same policy, just with different config-dir passthroughs. This
  is "one mechanism, many harnesses," not "choose the mechanism per
  harness."
- **Closest spec-level precedent: devcontainer.json.** A genuinely
  tool-agnostic, declarative environment definition, explicitly endorsed by
  Anthropic as the team-standardization answer and independently converged
  on by multiple practitioner repos running 2-4 different CLIs inside one
  container. It's a shared *definition*, not a *selector* — you author one
  devcontainer and every harness you install into it inherits the same
  boundary; there's no logic anywhere that decides "this harness gets
  policy A, that one gets policy B."
- **Closest policy-distribution precedent: managed settings / MDM /
  `requirements.toml`.** Real, vendor-built, documented "push channel" for
  an admin to set sandbox-related values from outside the developer's own
  config — but each channel is scoped to one vendor's own schema; there is
  no cross-harness admin channel that speaks Claude Code's `sandbox.*` and
  Codex's `sandbox_mode` and Gemini's `GEMINI_SANDBOX` uniformly.
- **`@anthropic-ai/sandbox-runtime` (srt)** is the closest a *vendor
  product* gets to a harness-independent wrapper (explicitly "arbitrary
  processes," not Claude-Code-only) — but it's an invocation-time OS
  wrapper (`npx sandbox-runtime <cmd>`), not a policy-selection layer; it
  applies whatever `~/.srt-settings.json` says, uniformly, to whatever
  binary you hand it.

None of these — devcontainer, managed settings, srt, ai-bwrap/ai-jail —
does the thing the question asks about most precisely: inspect *which*
harness is about to run and *choose* a different isolation boundary for it.
That combination (harness-aware selection + cross-harness application) is
unattested in the public record I could reach.

## C. Recommendation for a tool like jig, given A/B

Evidence supports, in order of how well-precedented each option is:

**(ii) Standardize on devcontainer as the shared environment, and (i) verify/require each harness's native sandbox inside it, fail-closed if absent — combined, not exclusive.** This is not a novel synthesis; it is exactly what Claude Code's own docs recommend for teams (§2: "layer approaches: running the sandboxed Bash tool inside a container or VM gives you OS-level command restrictions on top of the outer environment boundary") and exactly what the strongest practitioner precedent does (`aicontainer`: devcontainer for the OS boundary + one shared hook wired into each harness's own extension point for policy). Concretely, for a tool spanning several harnesses:

- Trade-off of **(i) pure defer-and-verify** (fail-closed if the harness's own sandbox isn't on): cheapest to build, matches how every vendor already expects to be governed (push into their schema, don't replace their mechanism), but only as strong as each harness's own sandbox — and per §1, none of the three vendors treats their native config-push channel as a hard security boundary on an unmanaged machine. Also does nothing to unify DSH/pi if those harnesses lack a native sandbox of comparable strength — you'd be fail-closed to "no isolation available" rather than getting one.
- Trade-off of **(ii) devcontainer standardization**: the only option with both vendor endorsement (Anthropic) and independent multi-harness practitioner validation (5+ repos). Gives one OS/filesystem/network boundary regardless of which harness is invoked inside it — which directly solves the "four harnesses, one guard" problem at the *sandbox* layer the way jig's guard already solves it at the *policy* layer. Costs: requires Docker Desktop/Docker Sandboxes or similar per-machine, adds setup friction devcontainer-naive harnesses (if any of the four lack a devcontainer feature) would need bespoke Dockerfile work for, and per Claude Code's own warning, still doesn't stop credential exfiltration if you run with bypassed permissions and mount host secrets carelessly — it's a boundary, not a silver bullet.
- Trade-off of **(iii) runtime platform** (E2B/Daytona/Docker Sandboxes/AgentCore): strongest isolation (VM/microVM), but every one surveyed is invoked by *your* code targeting *their* SDK/CLI — adopting one doesn't reduce jig's own build surface, it just relocates "which harness, which policy" logic from jig into glue code around that platform's API. Worth it only if VM-grade isolation is a stated requirement beyond what a devcontainer/bubblewrap boundary gives.
- Trade-off of **(iv) build the cross-harness selection layer**: per §B, this is **unmapped territory** — the closest real precedent (`ai-bwrap`/`ai-jail`) applies one fixed policy to everything rather than truly harness-aware selection, and no vendor or security-guidance source frames dynamic per-harness selection as a solved or recommended pattern. Building it would be the owner's own invention, not an implementation of an established pattern — legitimate to do, but should be labeled as novel work internally rather than "how the industry does it," and the two closest OSS wrapper projects (small, single-maintainer, Linux/macOS-only) are the only prior art to study before doing so.

**What's precedent vs. invention, explicitly:** "defer to native sandbox + verify fail-closed" and "standardize on devcontainer, layer native sandboxes inside it" are both attested, vendor-endorsed, and independently practitioner-validated — combining them is boring and well-trodden. Anything beyond that — a component that inspects which of the four harnesses is about to run and actively chooses or swaps in a different isolation mechanism per harness/run — has no clean industry precedent; the nearest things (ai-bwrap, ai-jail, srt) are uniform-policy wrappers, not selectors, and would be the owner's own design, not an implementation of a documented pattern.
