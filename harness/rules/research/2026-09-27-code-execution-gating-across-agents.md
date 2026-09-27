---
question: "How do coding-agent products gate a code-execution/interpreter tool (a persistent Python/JS interpreter, an eval/notebook execution surface) as opposed to a plain shell tool: does the product ship one, what is the default approval behaviour for it, is execution sandboxed (OS sandbox / container / VM) or on the host, and what does the vendor itself say about rule-based or classifier gating versus an isolation boundary?"
date: 2026-09-27
verdict: "No surveyed product runs host-level Python/JS execution with a prompt as its only control *and* presents that prompt as a security boundary. Three shapes exist. (a) Most products ship no interpreter tool at all and route all execution through a shell tool: Claude Code, Gemini CLI, Cursor, Cline, Aider, SWE-agent, OpenCode, Crush, Devin/Devin-Desktop, Jules, pi. (b) Where code execution does run, it runs inside an isolation boundary by default or by documented default-off design: Codex 'code mode' exec (off by default, experimental, and the shell sandbox still applies), OpenHands Python/IPython execution (Docker sandbox default; the process sandbox is documented as 'unsafe'), Amp `code_exec` (remote tool path documented; local CLI runs on the host with no approval), the hosted Anthropic/ChatGPT execution containers (gVisor), and cloud VMs (Jules, Devin, Cursor Cloud Agents). (c) The host-level cases ship no approval prompt at all, rather than a prompt as a control: oh-my-pi ships a persistent Python + JS `eval` kernel whose default approval mode is `yolo` (no prompt at all), and Amp's local `code_exec` runs under a documented no-approval default. Both vendors say so explicitly. pi, which ships no interpreter, documents no permission system whatsoever. Where a product does gate on patterns or a classifier, four vendors state in their own docs that the gate is not a boundary: Claude Code ('isn't a security boundary around the program'; 'sandboxing reduces risk but is not a complete isolation boundary'), Cursor ('Auto-review is not a security boundary'), oh-my-pi (pattern policy 'is not process or filesystem containment'), and OpenAI ('Auto-review ... is not a deterministic security guarantee'). The headline answer is therefore: the rule/prompt layer is everywhere presented as convenience, and the isolation boundary is the control that vendors say actually holds."
unverified:
  - "Amp `code_exec`: verified only from two Amp docs sentences (plugin API + MCP doc). I could not enumerate Amp's built-in tool list (docs point to `amp tools list`), could not confirm whether `code_exec` executes JavaScript/Python generally or only MCP-call plumbing, and could not confirm its default enablement."
  - "Codex code mode: docs key is `features.code_mode.enabled`; the runtime error string names `features.code_mode_host`. Whether both are required, and whether code mode is reachable in any shipped build, was not verified."
  - "Devin cloud sessions: no per-command approval gate found in the pages read in this session, but I did not fetch a page that states the default for cloud command execution; treat 'no approval gate documented' as absence of evidence."
  - "Jules: the exact approval question ('does Jules ask before each shell command inside its VM?') was not verified; the docs describe plan approval, not per-command prompts."
  - "Cursor, Windsurf/Devin Desktop, Cline, Crush, SWE-agent, OpenCode: 'no interpreter tool' is verified by absence in the pages read (tool inventories / docs indexes), not by reading every page of each product's docs."
sources_note: "Primary sources only, all fetched directly on 2026-09-27: vendor documentation pages, vendor source repositories (raw GitHub), vendor engineering blog posts, GitHub Security Advisories via `gh api /advisories`, GitHub issue search via `gh api search/issues`, and two named-practitioner posts. Web search was unavailable (every provider returned a bot challenge), so nothing here rests on a search-engine summary. Pages returned through a reader/HTML-to-text conversion rather than raw Markdown are marked [reader]. No project build/test command was run; nothing in this repo was modified except this file."
---

# How coding-agent products gate code execution

## Headline answer (short form)

Sorting the 18 sections below by what actually executes:

| Shape | Products | What gates the execution |
| :--- | :--- | :--- |
| No interpreter tool at all (shell only) | Claude Code, Gemini CLI, Cursor, Cline, Aider, SWE-agent, OpenCode, Crush, Devin, Devin Desktop, Jules, pi | shell approval rules / nothing; the shell itself is the execution surface |
| Interpreter ships, isolated by default | Codex (code mode, off by default), OpenHands (Docker by default), Anthropic API `code_execution` (gVisor), Jules/Devin/Cursor Cloud (VMs) | the isolation boundary, with the rule layer as an extra |
| Interpreter ships, host-level | oh-my-pi (`eval`, default `yolo`), Amp (`code_exec` on the local CLI, no approval) | nothing but the model's judgment; both say so in their own docs (pi also has no permission system, but ships no interpreter — see the row above) |

So: **every product either does not offer interpreter execution, sandboxes it, or states in its own documentation that the prompt/rule layer is not a boundary.** Several do all three at once. The only case where no boundary exists at all is the pair of single-author harnesses (oh-my-pi, pi) — and those are the two that document it most plainly.

## Method and verification legend

- **Directly fetched, raw (`Method: text` / `native` / raw GitHub)**: Claude Code docs (code.claude.com), OpenAI/Codex docs (learn.chatgpt.com `.md`), Gemini CLI docs (raw.githubusercontent.com), Cursor `.md` pages, Cline `.md` pages, Aider options page and `aider/args.py`, OpenHands `.md` pages, Devin `.md` pages, Jules docs, Crush README + `docs/config/README.md`, Amp markdown docs, Anthropic engineering post, `embracethered.com`, `simonwillison.net`.
- **[reader] conversion**: pages the `read` tool rendered from HTML (opencode.ai/docs/tools came through a Jina reader; Simon Willison's and the Anthropic post came through an HTML reader). Quotes from those are still verbatim from the page text, but were not extracted from raw Markdown.
- **GitHub advisory and issue data**: `gh api /advisories?affects=<package>` and `gh api search/issues -f q='...'`, both authenticated. Titles and IDs are quoted as returned. Issue-tracker data skews negative (only people who file bugs appear).
- **Could not reach**: `https://jules.google/docs/security/` (HTTP 404 — no such page); `https://docs.windsurf.com/windsurf/terminal` (redirects to `https://docs.devin.ai/desktop/terminal`); `https://docs.devin.ai/essential-guidelines/how-devin-works` (404); GitHub code search hit a 403 rate limit partway through the session (the few queries that completed are recorded with their `total_count`).
- **Not evidence**: this repository's own code, its rules, and the harness it is replacing were deliberately not used as evidence for any claim below.

---

# Lens 1 — Vendors

Each section answers the four contract questions in order: (1) ships a code-exec/interpreter tool? (2) default approval for it, with the exact key; (3) isolated or host; (4) the vendor's own words on rules vs boundary. Where a product ships no interpreter tool, (2)–(4) are answered for the shell tool that is the de facto execution surface, because in that case the shell *is* the code-execution surface.

## 1. Claude Code (Anthropic) — no interpreter tool; optional OS sandbox for shell only

**Ships a code-exec tool?** No. The tool set is `Bash`, `PowerShell`, `Monitor`, `Read`/`Edit`/`Write`/`Glob`/`Grep`, `WebFetch`/`WebSearch`, `NotebookEdit`, agent/skill tools. `NotebookEdit` edits `.ipynb` cells and is a file-editing tool, not an execution surface. There is no `eval`, no Python kernel, no JS runtime. (Claude Code's docs also treat interpreters as code execution: entering auto mode drops "Wildcarded interpreters like `Bash(python*)`" — https://code.claude.com/docs/en/permission-modes.)

**Default approval.** Permission modes, `permissions.defaultMode`: `default` (Manual), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. Since v2.1.283, auto mode is the built-in starting mode for interactive terminal and VS Code sessions: *"With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions."* (https://code.claude.com/docs/en/permission-modes) In auto mode a *classifier model* — not a rule list — reviews actions: *"A separate classifier model reviews actions before they run, blocking anything that escalates beyond your request, targets unrecognized infrastructure, or appears driven by hostile content Claude read."*

**Sandboxed or host.** Optional, and only for shell: *"Sandboxing provides OS-level enforcement that restricts what shell commands can access at the filesystem and network level. It applies only to Bash, PowerShell, and Monitor commands and their child processes."* (https://code.claude.com/docs/en/sandboxing) Implementation is Seatbelt on macOS and bubblewrap (+ optional seccomp) on Linux, via `sandbox.enabled`, `sandbox.autoAllowBashIfSandboxed` (defaults `true`), `sandbox.allowUnsandboxedCommands`, `sandbox.excludedCommands`, `sandbox.failIfUnavailable`, `sandbox.filesystem.*`, `sandbox.network.*`; there is an unsandboxed-retry escape hatch. Everything else is on the host: *"Built-in file tools, MCP servers, and hooks still run directly on your host."* (https://code.claude.com/docs/en/sandbox-environments)

**Vendor position on rules vs boundary.** The clearest in the industry. Rules are explicitly not a boundary: *"A Bash rule matches the command text Claude writes, after Claude Code splits compound commands and strips wrappers. It doesn't match the same program invoked in a different form, so a deny or ask rule covers the invocation Claude usually produces and isn't a security boundary around the program."* (https://code.claude.com/docs/en/permissions) The classifier is likewise not a boundary: *"The classifier is a per-action control, not an isolation boundary, so an isolation boundary still adds defense in depth for unattended runs..."* And: *"Sandboxing reduces risk but is not a complete isolation boundary."* (https://code.claude.com/docs/en/sandboxing) Anthropic's engineering post restates the doctrine with numbers: *"The deterministic boundary is what gets hit when everything probabilistic misses."* and, on auto mode, *"it's one layer of defense-in-depth inside a sandbox, not a substitute for one"* (https://www.anthropic.com/engineering/how-we-contain-claude, 2026-05-25).

## 2. Codex CLI (OpenAI) — ships a code-mode `exec` tool, experimental and off by default

**Ships a code-exec tool?** Yes, but not by default. The source tree contains `codex-rs/core/src/tools/code_mode/{mod.rs,execute_handler.rs,execute_spec.rs,wait_handler.rs,wait_spec.rs,delegate.rs}` and a host crate `codex-rs/code-mode-host/`; the public tool names are `codex_code_mode::PUBLIC_TOOL_NAME` (`exec`, plus a `wait` tool) and the module documents itself as *"the code-mode `exec` tool in the default namespace"* (https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs). Availability is gated by config: `features.code_mode.enabled`, described as *"Enable code mode feature configuration. This feature is under development and off by default."* plus `features.code_mode.excluded_tool_namespaces` and `features.code_mode.direct_only_tool_namespaces` (https://learn.chatgpt.com/docs/config-file/config-reference). When the host side is missing the product says so at runtime: *"Code Mode is unavailable because {error}. Falling back to direct tools; enable `features.code_mode_host` and install `codex-code-mode-host`."* and, in code-mode-only mode, *"Code mode will fail closed"* (mod.rs, quoted above).

**Default approval.** `approval_policy` = `on-request` | `never` (`untrusted` retired), with `approvals_reviewer` = `user` (default) | `auto_review`. Per the sandbox page, *"Sandboxing and approvals are different controls that work together. The sandbox defines technical boundaries. The approval policy decides when the agent must stop and ask before crossing them."* (https://learn.chatgpt.com/docs/sandboxing)

**Sandboxed or host.** Sandboxed, and the sandbox covers code mode's children: *"The sandbox applies to spawned commands, not just to built-in file operations."* Modes `read-only` / `workspace-write` / `danger-full-access`; Seatbelt on macOS, bubblewrap on Linux/WSL2 (with a bundled helper needing unprivileged user namespaces), a native Windows sandbox. `--dangerously-bypass-approvals-and-sandbox` / `--yolo` is documented as "No sandbox; no approvals (not recommended)".

**Vendor position on rules vs boundary.** Codex's rules system is scoped to *crossing* the boundary, not being one: *"Use rules to control which commands Codex can run outside the sandbox."* — and it is *"experimental and may change"*; on the always-ask side, *"Auto-review is a reviewer swap, not a permission grant... It only changes how Codex handles actions that already need approval"* and *"Auto-review improves the default operating point for long-running agentic work, but it is not a deterministic security guarantee."* (https://learn.chatgpt.com/docs/agent-configuration/rules, https://learn.chatgpt.com/docs/sandboxing/auto-review)

## 3. Gemini CLI (Google) — no interpreter tool; sandboxing is opt-in

**Ships a code-exec tool?** No. The complete tool reference lists exactly one execution tool: *"`run_shell_command` | `Execute` | Executes arbitrary shell commands. Supports interactive sessions and background processes. Requires manual confirmation."* Everything else is file system, interaction, MCP, memory, or the experimental task tracker (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/tools.md).

**Default approval.** `run_shell_command` requires manual confirmation by default; file mutators do too: *"You must manually approve tools that modify files or execute shell commands (mutators)."* Granular control is the policy engine at `~/.gemini/policies/*.toml` with `[[rule]] toolName`, `commandPrefix`, `argsPattern`, `decision` (`allow` | `deny` | `ask_user`), and priorities across Default/Extension/Workspace/User/Admin tiers; `ask_user` in non-interactive mode resolves to deny.

**Sandboxed or host.** Host by default; sandboxing must be turned on: `gemini -s` / `--sandbox`, `GEMINI_SANDBOX=true|docker|podman|sandbox-exec|runsc|lxc`, `{"tools": {"sandbox": "docker"}}` in `settings.json`, or `security.toolSandboxing` per tool. Methods: macOS Seatbelt (default profile `permissive-open`, *"denies operations by default; confines writes to the project directory while allowing broad file reads and network access"*), Docker/Podman (default image `ghcr.io/google/gemini-cli:latest`), gVisor/runsc, LXC, and Windows low-integrity. (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/sandbox.md)

**Vendor position.** Google's own docs frame sandboxing as *"a security barrier between AI operations and your environment"* and treat the policy engine as a decision layer separate from it; the docs do not claim rule matching is a boundary. Negative evidence: a critical advisory, *"Gemini CLI: Remote Code Execution via workspace trust and tool allowlisting bypasses"* (GHSA-wpqr-6v78-jr5g), and open issue #29070, *"security(sandbox): host shell injection via BUILD_SANDBOX path interpolation in sandbox.ts"* (2026-08-25).

## 4. Cursor — no interpreter tool; three Run Modes over an OS sandbox

**Ships a code-exec tool?** No interpreter tool appears in the tool pages. The tool set is search, web, rules, read, edit, **run shell commands**, browser, image generation, ask; `cursor.com/llms.txt` lists no Python/notebook tools page, and the terminal page is about shell execution. (Cursor's Cloud Agents do run full commands, but inside their own machine — see (3).)

**Default approval.** Run Modes: **Auto-review** (shipped as *"the recommended default"* in Cursor 3.6, 2026-05-29), **Allowlist**, **Run Everything**. Auto-review uses a classifier model instead of a rule list: the docs warn *"The classifier can make mistakes..."*. Ask Every Time was deprecated in 3.5 (2026-05-22) in favour of Allowlist with an empty allowlist. Sandboxing sits underneath and is configured in `sandbox.json` (`type` defaults to `"workspace_readwrite"`; `"insecure_none"` disables the sandbox; `networkPolicy.default` defaults to `"deny"`), and the merge rules are explicit: *"Enterprise team-admin policies and Cursor hardcoded security rules layer on top and cannot be weakened by either file."*

**Sandboxed or host.** Sandboxed in one of two OS mechanisms — macOS Seatbelt, or Linux Landlock + seccomp — with `CURSOR_SANDBOX` / `CURSOR_SANDBOX_LANDLOCK_STATUS` (`fully_enforced` | `bubblewrap`) and a documented fallback to asking for approval when the kernel can't support it. Cloud Agents are the exception that proves the rule: *"Cloud Agents run inside their own dedicated machine, so the agent never asks you to approve an action."* (https://cursor.com/docs/agent/security/run-modes.md, https://cursor.com/docs/reference/sandbox.md)

**Vendor position.** A section heading, verbatim: *"Auto-review is not a security boundary"* (https://cursor.com/docs/agent/security/run-modes.md).

## 5. Cline — no interpreter tool; the model flags its own commands

**Ships a code-exec tool?** No. Built-ins are `bash`, `editor`, `read_files`, `apply_patch`, `search`, `fetch_web`, `ask_question`, plus MCP and (on the SDK/CLI) custom tools (https://docs.cline.bot/tools-reference/all-cline-tools.md). Cline does ship Jupyter *editing* — generate/explain/improve a cell, *"The cell is inserted with proper notebook JSON structure, preserving metadata and ready to execute"* — which inserts a cell; the execution itself is the user's notebook kernel, not a Cline tool (https://docs.cline.bot/features/jupyter-notebooks.md).

**Default approval.** Per-category auto-approve toggles and a YOLO mode. The gate is a **model-supplied flag**, not a rule engine: *"Cline does not use a fixed allowlist. The model marks each command with a `requires_approval` flag based on the command and arguments. These are examples, not guarantees."* (https://docs.cline.bot/tools-reference/all-cline-tools.md)

**Sandboxed or host.** Host. No sandbox mechanism is documented; approval is the only control before a `bash` call runs with the user's permissions.

**Vendor position.** Cline's docs do not claim the flag is a boundary; the sentence *"These are examples, not guarantees"* is the vendor telling the reader not to treat the gate as deterministic. Two advisories exist for Cline Hub/Kanban WebSocket hijacking (GHSA-3cj3-hqcr-g934, GHSA-5c57-rqjx-35g2).

## 6. Aider — no interpreter tool; shell features are opt-in slash-commands

**Ships a code-exec tool?** No. Execution is `/run` (alias `!`), `/test`, `/lint`, plus `--test-cmd`, `--auto-test`, `--lint-cmd`, `--auto-lint`, `--suggest-shell-commands` (default `True`). Full command list at https://aider.chat/docs/usage/commands.html contains no eval/notebook command.

**Default approval.** Interactive confirmation on each shell action by default; `--yes-always` ("Always say yes to every confirmation") overrides it. In source, `--yes-always` has `default=None` (i.e. off unless set): https://github.com/Aider-AI/aider/blob/main/aider/args.py (`--yes-always` at line 760; `--suggest-shell-commands` default `True` at line 807).

**Sandboxed or host.** Host. No sandbox is documented.

**Vendor position.** Aider's documentation makes no security-boundary claim about `/run`; it is presented as a convenience command. Negative evidence: two low-severity advisories, an SSRF via the EC2 metadata endpoint (GHSA-hchg-qm84-cj9p) and code injection via `editor_coder.run` (GHSA-7w7m-v5vp-w699).

## 7. OpenHands — ships Python execution; Docker sandbox by default, process sandbox documented as unsafe

**Ships a code-exec tool?** Yes. The V0/V1 runtime executes *"various types of actions (shell commands, file operations, Python code, etc.) safely within the container"* (https://docs.openhands.dev/openhands/usage/architecture/runtime.md), and a Jupyter plugin *"extend[s] capabilities (e.g., Jupyter for IPython cells)"*. The SDK exposes `BashTool` and `TerminalTool` with an interactive-terminator option documented for *"ipython, python REPL, and other interactive CLI tools"* (`params: {"no_change_timeout_seconds": 3}`, https://docs.openhands.dev/sdk/guides/agent-interactive-terminal.md).

**Default approval.** The runtime itself does not prompt — it is an autonomous container. The SDK offers confirmation strategies: `AlwaysConfirm()`, `NeverConfirm()`, `ConfirmRisky()`, the last driven by `LLMSecurityAnalyzer`, which assigns LOW/MEDIUM/HIGH/UNKNOWN risk levels with a *model*, not a rule engine.

**Sandboxed or host.** Docker by default; three providers are documented: *"**Docker sandbox (recommended)** ... Good isolation from your host machine"*, *"**Process sandbox (unsafe, but fast)** ... Runs the agent server as a regular process on your machine. No container isolation"*, and Remote. Selection is via the legacy `RUNTIME` variable (`RUNTIME=docker` (default), `RUNTIME=process`, `RUNTIME=remote`); the process page repeats the warning: *"This mode provides **no sandbox isolation**. The agent can read/write files your user account can access and execute commands on your host system. Only use this in controlled environments."* (https://docs.openhands.dev/openhands/usage/sandboxes/overview.md, https://docs.openhands.dev/openhands/usage/sandboxes/process.md)

**Vendor position.** OpenHands states the isolation rationale as a security property of the container, not of any approval rule: *"Executing untrusted code can pose significant risks to the host system. A sandboxed environment prevents malicious code from accessing or modifying the host system's resources"*. There is no documented rule language claimed as a boundary; the failure mode is documented instead (the process sandbox).

## 8. SWE-agent — no interpreter tool; shell inside a container, no approval gate

**Ships a code-exec tool?** No. The agent-computer interface is bash plus file viewer/editor/search tools: *"The `bash` tool, allowing the agent to run shell commands (including invoking python scripts)"* (https://swe-agent.com/latest/config/tools/). The tool directory contains `registry`, `edit_anthropic`, `filemap`, `search`, `review_on_submit_m`, `forfeit`, `submit`, `web_browser`, `windowed*`, `diff_state`, `image_tools`, `multilingual_setup` — no interpreter bundle. `config/default.yaml` enables `enable_bash_tool: true`.

**Default approval.** None. SWE-agent is built for autonomous benchmark runs; there is no per-command confirmation in the documented loop.

**Sandboxed or host.** Container: *"The Deployment either starts a local Docker container (4), or it starts the container on a remote system like modal or aws (3)."* (https://swe-agent.com/latest/background/architecture/).

**Vendor position.** No boundary claim is made about tool gating, because there is no gate; isolation is the container.

## 9. Devin (cloud) — no interpreter tool documented; execution on a per-task VM

**Ships a code-exec tool?** No separate interpreter surface is documented in the Devin docs index (`https://docs.devin.ai/llms.txt`): the product surfaces are shell, editor, browser, and playbooks. Python appears only as Devin's *own* orchestration capability (a "Python SDK" for the API, and "Dynamic Workflows" where a Python script orchestrates sessions) — not as a model-facing code-execution tool.

**Default approval.** Not verified for cloud sessions in this session's fetches. The desktop/CLI products below document their own models; the cloud product's pages read here do not state a per-command approval default.

**Sandboxed or host.** Cloud VM per session (the CLI/desktop docs below cover the local case). No host execution.

**Vendor position.** Not stated on the pages read. Marked unverified above rather than inferred.

## 10. Devin CLI — no interpreter tool documented; `--sandbox` is OS-level and fails closed

**Ships a code-exec tool?** No interpreter tool is documented; execution is the command/PTY path.

**Default approval.** Permission rules in `Exec(...)`/`Read(...)`/`Write(...)` syntax; sandbox exclusion rules can be `allow`/`ask`/`deny`. The sandbox itself is opt-in per invocation (`--sandbox`) or enforced by team policy.

**Sandboxed or host.** OS-level when enabled, and it fails closed: *"If sandbox resolution fails (e.g., the sandboxing tools are unavailable on the user's platform), the CLI will **refuse to start** rather than running unsandboxed. This fail-closed behavior applies whether sandbox was enabled by a team setting or by the user passing `--sandbox` directly, ensuring the security intent is never silently bypassed."* Linux needs `bubblewrap` + `socat`; Windows hard-fails. Exclusion is also fail-closed: *"If a command can't be safely resolved (e.g., it can't be parsed), it stays inside the sandbox."* Enterprise enforcement modes are **Optional** (default) and **Required** (with a future **Strict** hinted). Network filtering is flagged *"currently unstable"*. (https://docs.devin.ai/cli/sandbox.md)

**Vendor position.** The fail-closed design is the position: the rule layer may decide *where* something runs, but the boundary is the OS sandbox, and the tool refuses to run unsandboxed rather than fall back to rules.

## 11. Devin Desktop (formerly Windsurf/Cascade) — no interpreter tool; four auto-execution levels

**Ships a code-exec tool?** No interpreter/notebook execution tool is documented for Cascade or the terminal integration; the agent runs terminal commands, edits files, and uses MCP. (The Windsurf docs now live under `docs.devin.ai/desktop/*`; `https://docs.windsurf.com/windsurf/terminal` redirects to `https://docs.devin.ai/desktop/terminal`.)

**Default approval.** Four auto-execution levels: **Disabled** (*"All commands require manual approval"*), **Allowlist Only**, **Auto** (*"The agent uses its judgment to determine whether a command is safe to auto-execute... only available for messages sent with premium models"*), **Turbo** (*"All commands are auto-executed immediately, except those in your deny list"*). Allow/deny lists use `cmd *` prefix semantics; team lists merge with user lists and *"The **denylist takes precedence** over the allowlist"*; admins can cap the maximum level. The Devin Local agent replaces these levels with `Allow` / `Ask` / `Deny` rules. (https://docs.devin.ai/desktop/terminal.md)

**Sandboxed or host.** Host, for the desktop agent: the "dedicated terminal" uses the user's shell (`zsh` on macOS, `bash` on Linux) with the user's env; no sandbox is documented for Cascade command execution on the pages read.

**Vendor position.** "Auto" is described as the *agent's* judgment ("uses its judgment to determine whether a command is safe"), which is a model judgment, not a rule engine; the documented list is a preference list, and the vendor exposes no claim that it is a boundary.

## 12. Google Jules — no interpreter tool; per-task cloud VM, plan approval instead of command approval

**Ships a code-exec tool?** No. Jules runs shell commands and edits files inside its VM; the docs index has no interpreter tool.

**Default approval.** Plan approval before any code is written: *"Once the plan is approved, Jules will start coding."* (https://jules.google/docs/running-tasks/). Per-command approval inside the VM is not documented (marked unverified). A secondary-agent "Planning Critic" claim appeared in my earlier session notes but its URL could not be re-verified this session, so it is not used as evidence here.

**Sandboxed or host.** Cloud VM: *"Jules runs in a virtual machine where it clones your code, installs dependencies, and modifies files."* (https://jules.google/docs/) with Python/Node/Go/Java/Rust and Docker preinstalled.

**Vendor position.** Jules' FAQ treats the VM as the boundary and pushes residual responsibility onto the user: *"When you run code in Jules, it's executed in a secure, cloud-based virtual machine (VM) with internet access... treat the environment with the same security precautions you would for any public or shared compute surface... **You are responsible for the code you run.**"* Note: `https://jules.google/docs/security/` returns HTTP 404 — there is no dedicated security page at that path.

## 13. OpenCode — no interpreter tool; permissions default to *allow*

**Ships a code-exec tool?** No. Built-ins are `bash`, `edit`, `write`, `read`, `grep`, `glob`, `lsp` (experimental), `apply_patch`, `skill`, `todowrite`, `webfetch`, `websearch`, `question`, plus custom tools and MCP. (`custom tools ... can execute arbitrary code` — a user-supplied extension point, not a built-in interpreter.)

**Default approval.** Permissive by default: *"By default, all tools are **enabled** and don't need permission to run."* Permissions are keyed per tool with `allow` / `ask` / `deny` in the `permission` config, most defaulting to `allow`; `doom_loop` and `external_directory` default to `ask`; `--auto` auto-approves everything not explicitly denied. (https://opencode.ai/docs/tools/, https://opencode.ai/docs/permissions/)

**Sandboxed or host.** Host. No sandbox is documented; the permission config is the only gate, and the default gate is open.

**Vendor position.** No boundary claim. Negative evidence: two serious advisories — *"Malicious website can execute commands on the local system through XSS in the OpenCode web UI"* (GHSA-c83v-7274-4vgp, critical) and *"OpenCode's Unauthenticated HTTP Server Allows Arbitrary Command Execution"* (GHSA-vxw4-wv6m-9hhh, high).

## 14. Crush (Charm) — no interpreter tool; asks by default

**Ships a code-exec tool?** No interpreter. Built-ins include `bash` plus `view`, `ls`, `grep`, `edit`, and MCP-provided tools (the README's own examples show `permissions allow view ls grep edit` and `permissions deny bash sourcegraph`). Crush's `crushrc` contains a *native Bash interpreter*, but that is for configuration, not a model-facing code-execution tool.

**Default approval.** Prompts by default: *"By default, Crush will ask you for permission before running tool calls."* `permissions allow <tool>` skips prompts; `permissions deny <tool>` hides tools entirely. `--yolo` skips all prompts: *"Be very, very careful with this feature."* `--yolo` is first-wins per workspace across attached clients (https://github.com/charmbracelet/crush, https://raw.githubusercontent.com/charmbracelet/crush/main/docs/config/README.md).

**Sandboxed or host.** Host. No sandbox documented; approval is the only control.

**Vendor position.** No boundary claim; the `permissions` reference describes `allow` as *"skips approval prompts"* and `deny` as *"hides tools from the agent entirely"* — a UI/UX gate, with `--yolo` as the documented off-switch. No advisory was found for Crush.

## 15. Amp (Sourcegraph) — ships `code_exec` (code mode); no approval by default

**Ships a code-exec tool?** Yes — `code_exec`, in a "code mode" alongside `tool_search`. Amp's MCP doc states the usage: *"Amp discovers saved remote MCP tools with `tool_search` and calls them through `code_exec`."*, and errors surface as JavaScript: *"Missing or mismatched structured results produce a catchable JavaScript error"* (https://ampcode.com/docs/customize/mcp). The plugin API references the same pair: MCP servers *"are named in the agent's rendered instructions so the model knows to reach them through code mode (`tool_search`/`code_exec`)"* (https://ampcode.com/docs/plugin-api). The built-in list itself is not published in the docs; they say *"You can see Amp's builtin tools by running `amp tools list` in the CLI."* Whether `code_exec` is generally available or gated was **not** verified — see the unverified list.

**Default approval.** None: *"By default, Amp does not ask for approval before running tools."* — stated twice on the tools page, including under the heading "Permissions": *"Amp does not ask for approval before running tools. Use a custom plugin to control tool use."* (https://ampcode.com/docs/tools) Amp's own permissions note (page modified 2026-08-05) describes the rule language and its limits: rules are checked *"in sequence until it finds a matching rule"*, stored under the `amp.permissions` key, with actions `allow` / `ask` / `reject` / `delegate --to <helper>` (a helper program, or an Open Policy Agent server). It states the string-matching nature of the gate outright: *"The `Bash` tool accepts the entire shell command pipeline to run in the `cmd` parameter. This is a string containing source code, so we need match any command line that looks like a git push command"*, and its own wildcard example, `amp permissions add ask Bash --cmd '*git*push*'`, is documented as matching `cd ../other-repo && git push` as well as `git commit -m 'WIP' && git push`. It also states the workaround dynamic that a dedicated interpreter reintroduces: *"Taking tools away, like preventing the agent from reading certain files, makes the agent look for an alternative, like running a Bash command instead to access file contents."* (https://ampcode.com/notes/permissions) The one trust gate Amp does have sits at the *server*, not the tool call: *"MCP servers in workspace settings (`.amp/settings.json`) require explicit approval before they can run. This prevents untrusted code from executing automatically when you open a project."* — whereas *"MCP servers in your global settings (`~/.config/amp/settings.json`) or passed via `--mcp-config` do not require approval."* (https://ampcode.com/docs/customize/mcp)

**Sandboxed or host.** Host for local threads. The remote option is an environment change, not a gate: orbs are *"remote machines where Amp agents work without using your computer. Every orb thread gets a fresh, isolated environment..."* (https://ampcode.com/docs/orbs). `amp --executor local|orb|runner:...` selects where the thread runs.

**Vendor position.** Amp's own mitigation advice is environmental, and its warning names the failure mode: *"Amp acts on content in your workspace. Untrusted repositories, MCP servers, and other external inputs can influence what Amp does. If you regularly work with untrusted sources, consider creating a custom policy plugin, or using an isolated development environment."* The policy hook exists (`amp.on('tool.call', ...)` returning `allow` / `reject-and-continue` / `modify` / `synthesize`), but it is off unless the user writes it.

## 16. oh-my-pi — ships persistent Python **and** JavaScript `eval`; default approval mode is `yolo`

**Ships a code-exec tool?** Yes, and it is switched on by default: a persistent `eval` tool with `eval.py` and `eval.js` both defaulting to `true`, plus `eval.tools.enabled`; configuration in `PI_PY`/`PI_JS`; `python.kernelMode` = `session` (default) or `per-call`; a retained `python -u runner.py` NDJSON subprocess with `%pip`, `%cd`, `%run`, `%%bash`, `!cmd`; default timeout 30s clamped to 1..3600; environment allow/deny lists intended to strip API keys (https://github.com/can1357/oh-my-pi/blob/main/docs/python-repl.md). The README markets it as the headline feature: *"Code execution w/ tool-calling — Most harnesses give the agent a Python sandbox and call it done. Ours runs persistent Python and a Bun worker, and either kernel can call back into the agent's own tools — read, search, task — over a loopback bridge."*

**Default approval.** `tools.approvalMode` defaults to **`yolo`**, which auto-approves the `read`, `write`, and `exec` tiers; the tool declares the `exec` tier, and subagents run headless with `tools.approvalMode: yolo` (https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md). The other modes are `always-ask` and `write`. So by default there is *no* prompt for `eval` — the strongest default-permissive finding in this survey.

**Sandboxed or host.** Host: the kernel is a subprocess of the harness with the user's ambient permissions. There is no documented OS sandbox for `eval`; the environment deny-list is a data-hygiene measure, not isolation.

**Vendor position — the most explicit in the survey.** Verbatim from the approval-mode doc: *"This pattern policy controls approval for the `bash` tool; it is not process or filesystem containment. An approved command retains the shell's ambient filesystem, network, and subprocess access. The `eval` tool also declares the `exec` tier and can spawn a shell via subprocess, so a `bash.patterns` `deny` rule does not apply to the same command run through `eval` — under `yolo`, that `exec` call resolves to `allow`."* Also: *"Tool approval does not authorize the underlying real-world action."* In other words the vendor states outright that its rule syntax is neither containment nor a way to constrain `eval`, and that the default resolves to allow.

## 17. pi (earendil-works, formerly `badlogic/pi-mono`) — no interpreter tool; no permission system at all

**Ships a code-exec tool?** No interpreter/eval tool is documented. The tools are the usual file/search/shell set (the `docs/` tree contains `how-pi-works.md`, `settings.md`, `containerization.md`, `security.md`, with no Python/REPL doc; `how-pi-works.md` describes extensions as TypeScript modules loaded into the Pi process — an extension surface, not a model-facing interpreter).

**Default approval.** There is no permission system: *"Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it."* and *"it does not ask for approval before every tool call"*. Project trust exists but is disclaimed: *"not a complete startup boundary"*.

**Sandboxed or host.** Host, by design. Isolation is the user's job: plain Docker, Docker Sandboxes, NVIDIA OpenShell, or the Gondolin micro-VM extension (QEMU, Node ≥ 23.6) — and even then only *"a narrow form of isolation"* when just the tools run in the VM.

**Vendor position.** pi is the clearest negative case: *"Treat model-generated commands and code as untrusted. Pi can read, change, and execute files with the permissions of the account that started it, and it does not ask for approval before every tool call... Safety comes from limiting the files, credentials, processes, and network services Pi can access... **Watching the transcript, using project trust, and reviewing changes do not create a security boundary.**"* Its security policy says *"lack of a built-in sandbox"* and *"Expected local-agent behavior"* are *"generally outside the security boundary"* (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md, `containerization.md`).

## 18. Hosted siblings — Anthropic API `code_execution`, ChatGPT Work cloud execution

**Anthropic `code_execution` (a different product from Claude Code).** A server-side tool: the model's code runs in an Anthropic-managed container with no internet access and no approval step; versions `code_execution_20250825` (bash + files), `code_execution_20260120` (adds REPL persistence), `code_execution_20260521` (adds a 90s wall clock), legacy `code_execution_20250522` (Python only), status `ga`. Anthropic's engineering post describes the same architecture for claude.ai: *"When Claude runs code inside claude.ai, it does so in a gVisor container on isolated infrastructure... The blast radius is minimal"* (https://www.anthropic.com/engineering/how-we-contain-claude).

**ChatGPT Work.** Cloud code/shell execution in a managed environment with its own network control: *"ChatGPT Work runs code and shell commands in a managed, isolated environment. Workspace policy and tool-specific controls determine which capabilities are available."* and *"ChatGPT web doesn't expose the local Codex sandbox or approval-mode selector"* (https://learn.chatgpt.com/docs/sandboxing). OpenAI's own framing ties this to code execution as the general pattern: *"Codex is built on a simple premise: everything is controlled by code."*

**Takeaway for both:** when execution is hosted, there is no per-command approval prompt at all — the boundary is the container, and the vendor's stated control is *where* the code runs, not what the model asked for.

---

# Lens 2 — Named practitioners

Practitioners here are the people who write up their own operating practice and their own failures. Two channels dominate, both fetched directly.

**Simon Willison** (`https://simonwillison.net/tags/sandboxing/`, 55 posts in the tag index as of 2026-09-27; page rendered through an HTML reader **[reader]**). The load-bearing post is his write-up of the Snowflake Cortex allow-list bypass, where the allow-list *"listed `cat` commands as safe to run without human approval, without protecting against this form of process substitution"*. His own verdict, verbatim: *"I've seen allow-lists against command patterns like this in a bunch of different agent tools and I don't trust them at all — they feel inherently unreliable to me. I'd rather treat agent commands as if they could do anything that process itself is allowed to do, hence my interest in deterministic sandboxes that operate outside of the layer of the agent itself."* He also wrote up the Rehberger research below (2026-08-27 post): *"In a few runs Claude tried to terminate the malware process once it noticed the compromise, but Auto Mode denied the cleanup command."*

**Johann Rehberger** (`https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/`, published 2026-08-26; fetched through an HTML reader **[reader]** — the page presents a table, and the quotes below are its text). He achieved host code execution through a website-summary request against Claude Code Opus 5 in Auto Mode: *"we explore how a simple website summary request hijacks `Claude Code Opus 5` in `Auto Mode` and achieves code execution with 60-80% attack success rate using a small sample size."* His table: `python3 -I -c` C2 chain **3/5 (60%)**; a `claude -p` subprocess **3/5 (60%)**; `claude -p` plus a file write **4/5 (80%)**. He sets this against the vendor-commissioned evaluation: *"This is interesting because a third-party evaluation commissioned by Anthropic showed a `0.00%` prompt injection attack success rate for Opus 5 in Auto Mode."* He also documents the classifier failing in both directions at once: *"the safety mechanism itself can become part of the failure. The classifier allowed the creation of the malware process, but then it blocked the command intended to stop it!"* The attack chain is relevant to the interpreter question: WebFetch → `curl` fallback (the fetch tool returned HTTP 415) → a ZIP containing a `struct.py` module-shadowing payload → `python3 -c 'import base64...'` executed inside the extracted archive. Disclosure outcome: *"Anthropic closed the report as **Informative** and that the behavior is working as designed. Anthropic's ... position is that Auto Mode is a convenience feature backed by a best-effort classifier, not a security guarantee. ... The real boundary is OS isolation and network egress control."*

**Channel bias, stated.** Practitioner blogs skew toward novel attacks; a post exists because something broke. That means the practitioner lens over-states attack success (small samples, adversarially chosen) and under-states the mundane case. The counter-bias is the vendor channel: Anthropic's own posts publish a favourable operating point, and every vendor page quoted in Lens 1 presents its own control in the best light.

---

# Lens 3 — Measured evidence

All numbers below are the sources' own; none are computed here.

| Source (URL) | Evidence kind | Result with numbers | Cost numbers | Named failure modes |
| :--- | :--- | :--- | :--- | :--- |
| https://www.anthropic.com/engineering/how-we-contain-claude (2026-05-25) | vendor engineering, telemetry | *"users approved roughly 93% of permission prompts"*; sandbox added to Bash: *"an 84% reduction in permission prompts"*; auto mode *"catches roughly 83% of overeager behaviors before they execute"*; footnote: *"roughly 0.4% of benign commands blocked"*, *"~17% of overeager actions get through"* | not stated in the fetched portion | *"Across 25 retries of that prompt, Claude completed the exfiltration 24 times."*; a pre-trust-dialog `.claude/settings.json` hook |
| https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool | vendor pricing / limits | container: Python 3.11, Linux, x86_64; *"Internet access: Completely disabled for security"*; *"Sandbox isolation: Full isolation from host system and other containers"*; containers expire after 30 days | *"1,550 free hours"*/org/month, then *"$0.05 USD per hour, per container"* | *"Claude can sometimes confuse these environments"* (multicomputer) |
| https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/ (2026-08-26) | adversarial evaluation | Auto Mode ASR 60% / 60% / 80% (n=5 each) on host code execution via `python3` | not stated | classifier both allowed the payload and blocked the cleanup; closed **Informative** |
| Anthropic-commissioned third-party eval, quoted by Rehberger | vendor-commissioned eval | *"a `0.00%` prompt injection attack success rate for Opus 5 in Auto Mode"* | — | contradicts the 60–80% adversarial result on the same product/mode |
| `gh api "/advisories?ecosystem=npm&affects=@anthropic-ai/claude-code"` | advisory DB | 20 advisories incl. **GHSA-7835-87q9-rgvv** high (2026-07-24) *"Sandbox Escape via Git Worktree Path Confusion Allows Unsandboxed Code Execution"*; **GHSA-fg94-h982-f3mm** (2026-02-05) exfiltration | — | sandbox escape via config injection, symlinks, `sed`, `find` (bypasses the approval prompt), domain-validation bypass, command execution before the trust dialog |
| `gh api "/advisories?..."` for the other products | advisory DB | Gemini CLI **GHSA-wpqr-6v78-jr5g** critical *"Remote Code Execution via workspace trust and tool allowlisting bypasses"*; OpenCode **GHSA-c83v-7274-4vgp** critical and **GHSA-vxw4-wv6m-9hhh** high; Aider SSRF; Cline GHSA-3cj3-hqcr-g934 | — | every one is a **bypass of the gate**, not a bypass of a container |
| `gh api search/issues -f q='repo:anthropics/claude-code permission bypass in:title'` | issue tracker | 239 matching issues; `repo:anthropics/claude-code sandbox escape in:title` → 8; `repo:openai/codex sandbox in:title` → 1,115; `repo:google-gemini/gemini-cli sandbox in:title` → 430 | — | issue trackers skew negative: only people who hit a bug file |
| Claude Code issue **#40831** (closed 2026-03-30) | issue tracker, reproduced | *"`sandbox.excludedCommands` ... **Glob match** (e.g., `"xcodebuild*"`) — matches the command with arguments, but **unsandboxes the entire shell invocation**, not just the matched command. Any command chained after the excluded command via `&&`, `;`, `||`, or `|` also runs outside the sandbox."* | — | the exact structural failure that the interpreter case repeats: a rule that matches a command string does not constrain the process |

The pattern in the measured evidence is consistent: *every measured failure is a bypass of the pattern/prompt/classifier layer*, and none of the quotes describing those failures claim the container was escaped as the primary cause.

---

# Lens 4 — In the wild

- **Adoption of the permissive end is small but real.** `oh-my-pi` (`can1357/oh-my-pi`): 33,449 stars, 3,570 forks, 3,350 issues open at fetch time — a real user base for a harness whose default is `yolo` with a Python/JS `eval` kernel. `pi` (`earendil-works/pi`): 109,686 stars, 13,948 forks — a very large installed base for a tool whose docs say it *"does not include a built-in permission system"*.
- **Maintenance state.** Both repositories are actively pushed (last push `oh-my-pi` 2026-09-27T12:51Z, `pi` 2026-09-26T12:37Z, via `gh api repos/<owner>/<repo>`), so neither permissive case is abandoned code. That matters: the permissive design is a live choice, not leftover cruft.
- **Cost incidents and the gate's own bugs.** The in-the-wild issues that mirror this survey's question are about the *gate*, not the interpreter: Claude Code `#83035` (2026-08-01) *"Workspace sandbox config silently dropped for sessions/subagents rooted in nested project directories (sandbox escape)"*; `#67735` *"Sandboxed Bash commands get a spurious backslash before `!` (shell-quote re-escapes the eval wrapper)"*, which incidentally shows Claude Code wraps sandboxed Bash in an internal `eval`; and OpenAI Codex `#47973` (2026-09-25) *"gVisor: another Linux sandbox option"* — vendors are still adding isolation backends rather than refining rule languages.
- **Abandonment / deprecation in the gating layer itself.** Ask-Every-Time was **deprecated** in Cursor 3.5 (2026-05-22) in favour of Allowlist, and *"the recommended default"* became Auto-review in 3.6 (2026-05-29) — i.e. the industry's most restrictive default (ask on everything) was retired as unusable, which is the same "approval fatigue" mechanism Anthropic measured at 93%. No product in this survey moved in the opposite direction (from permissive to strict-by-default) in the same window.
- **What the wild does not show.** No public repository, advisory, or issue was found in this session that documents a *host-level Python/JS interpreter tool with a prompt as its only control* being exploited — because, with one exception (Rehberger's `python3` chain through a shell tool in Claude Code), the surveyed products that run arbitrary code already run it inside a container or VM, and the products that run interpreters on the host (oh-my-pi, pi) are single-maintainer harnesses too young and too small to be a reward target.

## Four-lens roll-up

"Task type" in this survey is always the same — coding-agent operation on a real repository — so the column records *what kind of evidence* each source is, which is the distinction that matters when the numbers disagree.

| Source | Task type (evidence kind) | Result | Cost numbers | Named failure modes |
| :--- | :--- | :--- | :--- | :--- |
| Vendor engineering post, https://www.anthropic.com/engineering/how-we-contain-claude | vendor telemetry, 2026-05-25 | classifier catches 83%, misses ~17%; permit-prompt approval rate 93% | 84% fewer prompts with sandbox | 24/25 exfiltrations succeeded in one red-team run |
| Vendor product docs, https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool | vendor spec | server-side container, no internet, no approval step | 1,550 h/month free, then $0.05/container-hour | model confuses two execution environments |
| Named practitioner, https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/ | adversarial eval, n=5 | Auto Mode ASR 60/60/80% for host exec | none | classifier allowed payload, blocked cleanup; closed **Informative** |
| Named practitioner, https://simonwillison.net/tags/sandboxing/ | operating practice, 2026 | allow-lists "inherently unreliable"; prefers deterministic sandboxes | none | Snowflake Cortex allowlist bypass via process substitution |
| Advisory DB (`gh api /advisories`) | vendor-patched vulnerabilities | 20 Claude Code advisories; critical Gemini CLI and OpenCode advisories | none | escapes and gate bypasses: worktree path confusion, symlinks, `sed`, `find`, trust-dialog pre-execution |
| Issue tracker (`gh api search/issues`) | user-reported bugs | 239 Claude Code "permission bypass" issues; 1,115 Codex "sandbox" issues | none | `sandbox.excludedCommands` glob unsandboxes an entire chained shell invocation (#40831) |
| Repository statistics (`gh api repos/...`) | adoption | oh-my-pi 33,449 stars; pi 109,686 stars | none | the two host-level harnesses are the two that document having no boundary |

---

# Product comparison table

| # | Product | Ships a code-exec/interpreter tool? | Default approval for it (exact key/flag) | Sandbox or host | Vendor's stated rule-vs-boundary position |
| :-- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Claude Code** (Anthropic) | **No** — shell/PowerShell/Monitor + `NotebookEdit` (editing only) | Permission modes; `permissions.defaultMode`; since v2.1.283 auto mode (a classifier) is the built-in starting mode | Host by default; optional OS sandbox for Bash only (`sandbox.enabled`, Seatbelt/bubblewrap) | Rules *"isn't a security boundary around the program"*; classifier is *"a per-action control, not an isolation boundary"*; *"Sandboxing reduces risk but is not a complete isolation boundary"* |
| 2 | **Codex CLI** (OpenAI) | **Yes, off by default** — code mode `exec`/`wait`; `features.code_mode.enabled` *"under development and off by default"* | `approval_policy` (`on-request` \| `never`), `approvals_reviewer` (`user` default) | Sandboxed (`read-only`/`workspace-write`/`danger-full-access`; Seatbelt/bwrap/Windows) — *"The sandbox applies to spawned commands"* | Rules control *"which commands Codex can run outside the sandbox"*; auto-review is *"not a deterministic security guarantee"* |
| 3 | **Gemini CLI** (Google) | **No** — exactly one execution tool, `run_shell_command` | Manual confirmation for mutators; policy engine `~/.gemini/policies/*.toml` (`commandPrefix`/`commandRegex`, `ask_user`) | Host by default; opt-in Seatbelt / Docker / gVisor / LXC (`-s`, `GEMINI_SANDBOX`, `tools.sandbox`) | Sandboxing framed as *"a security barrier"*; no claim that policy rules are a boundary; critical advisory for *"tool allowlisting bypasses"* |
| 4 | **Cursor** | **No** interpreter; terminal/shell tool; Cloud Agents run on their own machine | Run Modes: **Auto-review** default since 3.6 (2026-05-29), Allowlist, Run Everything | Sandboxed: `~/.cursor/sandbox.json` (Seatbelt / Landlock+seccomp), `networkPolicy.default: "deny"` | Heading, verbatim: *"Auto-review is not a security boundary"* |
| 5 | **Cline** | **No** — `bash`, `editor`, `read_files`, `apply_patch`, `search`, `fetch_web`; Jupyter page is cell *editing* | Model-supplied `requires_approval` flag + per-category toggles + YOLO mode | Host; no sandbox documented | *"Cline does not use a fixed allowlist... These are examples, not guarantees"* |
| 6 | **Aider** | **No** — `/run`, `/test`, `--test-cmd` (shell) | Interactive confirmation; `--yes-always` (`action="store_true", default=None` in `aider/args.py`) | Host; no sandbox documented | No boundary claim made |
| 7 | **OpenHands** | **Yes** — `BashTool`/`TerminalTool`, Jupyter/IPython kernel, Python actions | Runtime is autonomous; SDK strategies `AlwaysConfirm()` / `NeverConfirm()` / `ConfirmRisky()` + `LLMSecurityAnalyzer` (LLM risk levels) | **Docker sandbox by default** (`RUNTIME=docker`); `RUNTIME=process` documented *"unsafe"*, *"No container isolation"* | Container is the stated security property: *"A sandboxed environment prevents malicious code from accessing or modifying the host system's resources"* |
| 8 | **SWE-agent** | **No** — ACI is bash + file tools | None (autonomous) | Container (local Docker, Modal, AWS) | No gate to describe; the container is the isolation |
| 9 | **Devin** (cloud) | **No** interpreter documented | Not verified for per-command approval | Per-session cloud VM | Not stated on the pages read |
| 10 | **Devin CLI** | **No** interpreter documented | `Exec(...)`/`Read(...)`/`Write(...)` rules; sandbox on/off via `--sandbox` or team policy | OS sandbox, **fail-closed**: *"the CLI will refuse to start rather than running unsandboxed"*; needs `bwrap`+`socat` on Linux | The boundary is the OS sandbox; rules decide where a command runs — exclusions are *"fail-closed"* |
| 11 | **Devin Desktop** (ex-Windsurf) | **No** interpreter documented; terminal commands only | Auto-execution levels **Disabled / Allowlist Only / Auto / Turbo**; `cmd *` prefixes; denylist wins | Host (user's shell) | "Auto" = *"the agent uses its judgment"*; no boundary claim |
| 12 | **Google Jules** | **No** interpreter documented | Plan approval (*"Once the plan is approved, Jules will start coding"*); per-command approval not documented | Cloud VM per task | VM is the boundary; *"You are responsible for the code you run"* |
| 13 | **OpenCode** | **No** built-in interpreter (custom tools *"can execute arbitrary code"*) | *"By default, all tools are enabled and don't need permission to run"*; `permission` per-tool `allow`/`ask`/`deny`; `--auto` | Host; no sandbox documented | No boundary claim; critical advisories for XSS→command execution and an unauthenticated HTTP server |
| 14 | **Crush** (Charm) | **No** — `bash` + built-ins + MCP | *"By default, Crush will ask you for permission before running tool calls"*; `permissions allow/deny`; `--yolo` | Host; no sandbox documented | No boundary claim; `allow` = *"skips approval prompts"*, `deny` = *"hides tools from the agent entirely"* |
| 15 | **Amp** (Sourcegraph) | **Yes** — `code_exec` (JS) with `tool_search` ("code mode") | *"By default, Amp does not ask for approval before running tools"*; plugin `tool.call` hooks return allow/reject/modify/synthesize | Host for local threads; **orbs** = *"remote machines"*, `--executor local\|orb\|runner:<name>` | Advises *"an isolated development environment"* for untrusted input; `amp.permissions` rules match strings (*"a string containing source code"*), per https://ampcode.com/notes/permissions; no claim that the plugin layer is a boundary |
| 16 | **oh-my-pi** | **Yes, on by default** — persistent Python **and** JS `eval` (`eval.py`/`eval.js` default `true`, `python.kernelMode`) | `tools.approvalMode` **defaults to `yolo`** (auto-approves `read`/`write`/`exec`); `eval` declares `exec` | **Host** — subprocess with the user's permissions | *"pattern policy ... is not process or filesystem containment"*; a `bash.patterns` deny *"does not apply to the same command run through `eval`"*; *"under `yolo`, that `exec` call resolves to `allow`"* |
| 17 | **pi** (earendil-works) | **No** interpreter documented | **No permission system**: *"Pi does not include a built-in permission system..."* | **Host**, by design; isolation is the user's Docker/VM | *"Watching the transcript, using project trust, and reviewing changes do not create a security boundary"*; *"lack of a built-in sandbox"* is outside its security boundary |
| 18 | **Anthropic API `code_execution_*` / ChatGPT Work** (adjacent products) | **Yes** — Bash + Python REPL, `code_execution_20250825/20260120/20260521`; ChatGPT cloud code+shell | No approval step; the tool is enabled by adding it to the request | **Sandboxed / hosted**: *"Internet access: Completely disabled"*, *"Full isolation from host system and other containers"*; gVisor; ChatGPT *"managed, isolated environment"* | The boundary is the container; controls are workspace policy and tool availability, not command patterns |

---

# Not verified

Stated plainly, so nobody has to guess what rests on inference:

1. **Amp `code_exec`** — I could not enumerate Amp's built-in tool list (the docs say to run `amp tools list`), could not confirm whether `code_exec` runs JavaScript/Python generally or only MCP-call plumbing, could not confirm its default enablement, and found no `sandbox` or `approval` keyword anywhere in `docs/cli/settings`, `docs/the-dial`, `docs/sdk`, or `docs/using-amp/how-we-work` (grep → no matches). `https://ampcode.com/docs/llms.txt` is 404 (use `sitemap.xml`).
2. **Codex code mode** — docs key `features.code_mode.enabled` vs the runtime string's `features.code_mode_host`; whether both are required, and whether code mode is reachable in a shipped build, was not verified. The `@exec:` pragma wording was not fetched.
3. **Devin cloud** — no page fetched this session states the per-command approval default for cloud sessions. Absence of evidence, not evidence of absence.
4. **Jules** — the per-command approval question inside the VM is not answered by any page fetched; `https://jules.google/docs/security/` returns HTTP 404, so no dedicated security page exists to check. A "Planning Critic" secondary-agent claim (*"9.5% reduction in task failure rates"*) from my earlier notes is **not** on `https://jules.google/docs/`, `.../running-tasks/`, `.../changelog/`, or `.../faq/` (all fetched), and its URL could not be re-verified, so it is excluded from the evidence.
5. **"No interpreter tool" for Cursor, Cline, Crush, SWE-agent, OpenCode, Devin Desktop** rests on the tool inventories and doc indexes read (tool reference pages, `sitemap`/`llms.txt` listings), not on a full source audit of each product. `https://cursor.com/llms.txt` lists no Python/notebook/interpreter page (only an SDK-in-Python page).
6. **`pi`'s tool inventory** — `packages/coding-agent/src/tools` returned HTTP 404 at the source path tried, so its absence-of-interpreter claim rests on the docs tree only.
7. **Web search was unavailable** in this session (every provider returned a bot challenge). No search-engine sweep was possible; this is a source-directed survey, not an exhaustive one.
8. **GitHub code search** hit a 403 rate limit; the queries that completed are recorded with their `total_count`. `gh api` code search accepts only single-token queries here.
9. **No sandbox product exists to test** for Cline, Aider, Crush, OpenCode, or pi — the claim "no sandbox documented" cannot be strengthened to "no sandbox exists" without running the software.
10. **One secondary attribution was dropped**: a practitioner quote about OpenAI's sandboxes attributed to Thomas Ptacek (via Reuters) is present in my earlier session notes but I could not re-verify its URL, so it is not used above. The reported July 2026 OpenAI↔Hugging Face sandbox-escape incident and Anthropic's *"Investigating three real-world incidents in our cybersecurity evaluations"* post (141,006 eval runs, three incidents, malware reaching 15 real systems) are likewise **not cited** above: `https://www.anthropic.com/news/investigating-three-real-world-incidents` returns 404 and I did not find the correct path in this session.

# No precedent found

Things I looked for and did not find, phrased as negatives so they can be refuted:

- **No vendor documentation, for any product, claims its allow-list/deny-list/pattern language is a security boundary.** Four vendors explicitly disclaim it (Anthropic, Cursor, OpenAI, oh-my-pi's author). None asserts it.
- **No product was found that ships a host-level Python/JS interpreter, gates it with a prompt, and presents that prompt as sufficient.** The host-level interpreter cases are oh-my-pi (no prompt at all by default) and Amp's local `code_exec` (which asks only if you add rules); pi, which ships no interpreter, has no permission system at all.
- **No interpreter/eval tool** in Claude Code, Gemini CLI, Cursor, Cline, Aider, SWE-agent, OpenCode, Crush, Devin CLI, Devin Desktop, or Jules.
- **No advisory found** for OpenHands, Crush, or Amp via `gh api /advisories?affects=<package>` (those queries returned nothing). Cursor's sandbox, oh-my-pi, and pi were **not** queried, so nothing is claimed about them. A "no results" here means the package name did not match a published package, not that no vulnerability exists.
- **No measured evaluation comparing interpreter-tool gating across products** exists in public. Every number found is either vendor telemetry about one product or an adversarial result about one product; nothing puts two products' gates side by side.
- **No product moved from permissive-by-default to strict-by-default** in the 2026 window observed; the only default changes were in the opposite direction (Cursor retiring Ask-Every-Time; Claude Code making auto mode the starting mode).

# Verdict — what the evidence supports

**Does any surveyed product run host-level Python/JS execution with a prompt as its only control? No. The products that run interpreters on the host ship no prompt at all by default; everything else either sandboxes its interpreter or ships none.**

Everything else lands in one of three bins, and the boundaries between the bins are documented in the vendors' own words:

1. **No interpreter tool** (the largest group, 12 of the 18 sections). Claude Code, Gemini CLI, Cursor, Cline, Aider, SWE-agent, OpenCode, Crush, Devin CLI, Devin Desktop, Jules, and pi all execute through a shell tool or a container/VM, and none of them ships a model-facing Python/JS kernel or eval surface. Notably, Claude Code's own docs classify interpreters as arbitrary code execution — entering auto mode drops *"Blanket `Bash(*)`"* and *"Wildcarded interpreters like `Bash(python*)`"* — which is the same reasoning an approval design should apply to a dedicated interpreter tool.
2. **Interpreter ships, isolation by default** (Codex code mode, OpenHands, Anthropic API, ChatGPT Work, Jules/Devin/Cloud VMs). Codex's code mode is off by default and its shell sandbox still applies; OpenHands defaults to Docker and documents its process sandbox as *"unsafe"*; Anthropic's hosted tool has no internet access and no approval step at all — the container *is* the control.
3. **Interpreter ships on the host, with no prompt by default** (oh-my-pi, and Amp's local `code_exec` with *"By default, Amp does not ask for approval before running tools"*). oh-my-pi is the sharpest case: a persistent Python **and** JavaScript kernel, default approval mode `yolo`, and a vendor note granting that a `bash.patterns` deny *"does not apply to the same command run through `eval`"*.

**What this means for the decision in front of us.** The industry's answer to "how do you gate a code-execution tool?" is not a better rule language. It is: *don't ship one where a shell exists; if you do ship one, put it behind an OS sandbox, a container, or a VM; and if you run it on the host, say in the docs that nothing but the isolation boundary will save the user.* The evidence that rules cannot be the boundary is not theoretical — it is the vendors' own text: *"isn't a security boundary around the program"*, *"Auto-review is not a security boundary"*, *"not deterministic security guarantee"*, *"is not process or filesystem containment"*, plus 239 filed permission-bypass issues on one product and a critical advisory on another whose title is literally *"Remote Code Execution via workspace trust and tool allowlisting bypasses"*.

**What the evidence does not support.** It does not support the claim that sandboxing is sufficient: Anthropic says *"Sandboxing reduces risk but is not a complete isolation boundary"*; Claude Code has shipped multiple sandbox escapes (GHSA-7835-87q9-rgvv, GHSA-ff64-7w26-62rf); and the same vendor's telemetry shows ~17% of overeager actions pass a classifier while 0.4% of benign commands are blocked. It also does not support *any* number for the cross-product question — nobody has measured two products' gates against each other.

**What is missing.** (a) An adversarial evaluation of any interpreter tool that is not Claude Code — notably oh-my-pi's `eval`, which is exactly the configuration (host, persistent kernel, no prompt) that the rest of the field has moved away from. (b) A page anywhere that states a default for per-command approval in Devin cloud or in Jules' VM. (c) Any statement from Cursor, Cline, Crush, or OpenCode about what their prompt/allow-list layer is *for* if not security — the absence of a disclaimer is not a claim, and should not be read as one.

The defensible one-sentence answer to the headline question: **the industry-wide rule is that the prompt is a convenience and the sandbox is the control; the only products that break the rule are the ones whose authors wrote down that they were breaking it.**

---

# Sources

Fetched 2026-09-27 unless a publication date is given. "[reader]" marks a page converted from HTML rather than raw Markdown.

**Anthropic — Claude Code and the API code-execution tool**

1. https://code.claude.com/docs/en/permissions — Bash rule matching, `bash-rule-limits`, read/Edit deny limits.
2. https://code.claude.com/docs/en/sandboxing — OS-enforced Bash sandbox, `autoAllowBashIfSandboxed`, limitations.
3. https://code.claude.com/docs/en/sandbox-environments — built-in file tools/MCP/hooks on the host; classifier *"is a per-action control, not an isolation boundary"*.
4. https://code.claude.com/docs/en/permission-modes — modes, `auto` as the built-in starting mode (v2.1.283+), dropping `Bash(python*)` on entering auto mode.
5. https://www.anthropic.com/engineering/how-we-contain-claude (2026-05-25) — three containment patterns, 93% approval rate, 83%/17%/0.4%, 84% prompt reduction. [reader]
6. https://www.anthropic.com/engineering/claude-code-auto-mode — the auto-mode engineering deep dive (URL confirmed 200; content read via the permission-modes page's link).
7. https://claude.com/blog/auto-mode — auto-mode announcement (URL confirmed 200).
8. https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool — `code_execution_*` versions, container limits, pricing.
9. `gh api "/advisories?ecosystem=npm&affects=@anthropic-ai/claude-code"` — 20 advisories, including GHSA-7835-87q9-rgvv, GHSA-ff64-7w26-62rf, GHSA-4q92-rfm6-2cqx, GHSA-mhg7-666j-cqg4, GHSA-66q4-vfjg-2qhh, GHSA-qgqw-h4xq-7w8w, GHSA-vhw5-3g5m-8ggf, GHSA-5hhx-v7f6-x7gv.
10. `gh api search/issues -f q='repo:anthropics/claude-code sandbox escape in:title'` → 8; `... permission bypass in:title` → 239; issue #40831 (closed 2026-03-30), #83035 (2026-08-01), #67735.

**OpenAI — Codex**

11. https://learn.chatgpt.com/docs/sandboxing — sandbox modes, `approval_policy`, `approvals_reviewer`, ChatGPT Work cloud execution.
12. https://learn.chatgpt.com/docs/config-file/config-reference — `features.code_mode.enabled`, *"under development and off by default"*.
13. https://learn.chatgpt.com/docs/agent-configuration/rules — *"control which commands Codex can run outside the sandbox"*; `prefix_rule`.
14. https://learn.chatgpt.com/docs/sandboxing/auto-review — *"a reviewer swap, not a permission grant"*, *"not a deterministic security guarantee"*.
15. https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/mod.rs (and `codex-rs/code-mode-host/`) — `exec`/`wait`, unavailability string.
16. `gh api search/issues -f q='repo:openai/codex sandbox in:title'` → 1,115, including #47973 (2026-09-25); advisories GHSA-xrxf-jgv3-qmrm (critical), GHSA-w5fx-fh39-j5rw (high).

**Google — Gemini CLI and Jules**

17. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/tools.md — the execution category is `run_shell_command` alone.
18. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/sandbox.md — opt-in sandboxing, `permissive-open` default profile, `SANDBOX_MOUNTS`, `BUILD_SANDBOX`.
19. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/policy-engine.md — `allow`/`deny`/`ask_user`, tier precedence.
20. `gh api search/issues -f q='repo:google-gemini/gemini-cli sandbox in:title'` → 430, incl. #29070 (2026-08-25), #27090; advisory GHSA-wpqr-6v78-jr5g (critical).
21. https://jules.google/docs/ — *"Jules runs in a virtual machine..."*; https://jules.google/docs/running-tasks/ — *"Once the plan is approved, Jules will start coding."*
22. https://jules.google/docs/security/ → HTTP 404 (recorded as "no such page").

**Cursor, Cline, Aider, OpenCode, Crush**

23. https://cursor.com/docs/agent/security/run-modes.md — Run Modes, *"Auto-review is not a security boundary"*.
24. https://cursor.com/docs/reference/sandbox.md — `sandbox.json`, merge order, network policy defaults, `CURSOR_*` env vars.
25. https://docs.cline.bot/tools-reference/all-cline-tools.md — tool list, *"does not use a fixed allowlist"*, `requires_approval`.
26. https://docs.cline.bot/features/jupyter-notebooks.md — cell generation/insertion, not execution.
27. https://aider.chat/docs/config/options.html and https://github.com/Aider-AI/aider/blob/main/aider/args.py — `--yes-always` (`default=None`), `--suggest-shell-commands` (`default=True`).
28. https://aider.chat/docs/usage/commands.html — `/run`, `/test`, no eval command.
29. https://opencode.ai/docs/tools/ and https://opencode.ai/docs/permissions/ — *"all tools are enabled and don't need permission to run"*, `permission` config, `--auto`. [reader]
30. https://github.com/charmbracelet/crush and https://raw.githubusercontent.com/charmbracelet/crush/main/docs/config/README.md — *"By default, Crush will ask you for permission before running tool calls"*, `permissions allow/deny`, `--yolo`.

**OpenHands, SWE-agent, Devin**

31. https://docs.openhands.dev/openhands/usage/sandboxes/overview.md and `.../process.md` — Docker default, process sandbox *"unsafe"* / *"no sandbox isolation"*, `RUNTIME` values.
32. https://docs.openhands.dev/openhands/usage/architecture/runtime.md — Jupyter/IPython plugin, *"safely within the container"*.
33. https://docs.openhands.dev/sdk/guides/agent-interactive-terminal.md — interactive terminator for *"ipython, python REPL"*; SDK confirm strategies and `LLMSecurityAnalyzer`.
34. https://swe-agent.com/latest/background/aci/, https://swe-agent.com/latest/config/tools/, https://swe-agent.com/latest/background/architecture/ — bash tool, container/remote deployment, no approval gate.
35. https://docs.devin.ai/cli/sandbox.md — `--sandbox`, fail-closed **"refuse to start"**, `bwrap`+`socat`, exclusion rules.
36. https://docs.devin.ai/desktop/terminal.md — the four auto-execution levels, denylist precedence, admin cap (formerly the Windsurf Cascade terminal page; `https://docs.windsurf.com/windsurf/terminal` redirects here).

**Amp**

37. https://ampcode.com/docs/tools — *"By default, Amp does not ask for approval before running tools."*
38. https://ampcode.com/notes/permissions (modified 2026-08-05) — `amp.permissions`, rule actions, *"a string containing source code"*, the OPA helper.
39. https://ampcode.com/docs/customize/mcp and https://ampcode.com/docs/plugin-api — `tool_search` / `code_exec`.
40. https://ampcode.com/docs/orbs — *"remote machines"* per thread; `--executor`.
41. https://ampcode.com/docs/llms.txt → HTTP 404 (use `sitemap.xml`).

**oh-my-pi and pi**

42. https://github.com/can1357/oh-my-pi/blob/main/docs/python-repl.md — persistent Python/JS `eval`, `%pip`/`%%bash`, timeouts, env allow/deny.
43. https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md — `tools.approvalMode` default `yolo`, tiers, *"is not process or filesystem containment"*.
44. https://github.com/can1357/oh-my-pi (README) — *"Ours runs persistent Python and a Bun worker..."*; 33,449 stars / 3,570 forks / 3,350 open issues (2026-09-27).
45. https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md — *"Pi does not include a built-in permission system..."*.
46. https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/how-pi-works.md and `containerization.md` — *"Enabled tools use the operating-system permissions of the Pi process"*, Docker/Gondolin isolation.
47. https://github.com/earendil-works/pi — 109,686 stars / 13,948 forks / 226 open issues (2026-09-27).

**Named practitioners**

48. https://simonwillison.net/tags/sandboxing/ — 55-post tag index; the Snowflake Cortex allow-list bypass and Willison's own verdict on allow-lists. [reader]
49. https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/ (2026-08-26, Johann Rehberger) — Auto Mode ASR 60/60/80%, closed **Informative**. [reader]

**Rules followed**

50. `harness/rules/decisions/2026-09-22-research-four-lenses.md` (this repository) — the four-lens standard and rules of evidence.
