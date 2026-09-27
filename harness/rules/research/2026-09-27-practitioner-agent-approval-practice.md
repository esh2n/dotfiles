---
question: "コーディングエージェントの実行を、著名人と企業は実際にどう運用しているか（yolo / サンドボックス / allowlist / プロンプトのどれか）、および製品側の既定のゲートと隔離"
date: 2026-09-27
verdict: "12 名の著名人の中に『毎回の操作を丁寧に承認する』という運用は一人もいない。内訳は yolo＋サンドボックス（Willison、Karpathy はツール選択で）、yolo＋Docker（Ronacher）、上限なしループ（Huntley）、フラグ＋ハーネス（Horthy）、『ゲートはプロンプトではなくハーネス』（Hashimoto）、プロセス分離とレビュー（Vincent）、本番資格情報で実行して事故を起こした実例（Yegge）。企業側の公開実践（Cloudflare、Shopify、StrongDM）は permission 層を書かず、投資も公開も検証層（テスト、CI、複製環境）に置く。ルールベースのゲートを恒久的なセキュリティ境界として擁護した記述は、製品の既定値以外に一件も無い。"
unverified:
  - "著名人の運用は全て自己申告。監査された記録は無く、yolo の証言は Karpathy が capability の段差を置く 2025-12 をまたぐ"
  - "Google / OpenAI / Cloudflare / Shopify の内部で、どの承認モードを使っているかを書いた公開ポリシーは無い（内部記事は workflow のみ）"
  - "Gemini CLI の --yolo フラグ（policy-engine ページは yolo を mode としてのみ記載）"
  - "StrongDM の一次ページ（factory.strongdm.ai は RSS のみ。引用は Willison のページ経由で TRANSCRIBED）"
  - "Twitter/X 由来の引用（Willison 2025-10-22、Ronacher 2025-06-12、Yegge 2025-07-19、Karpathy 2026-02-21）は投稿自体を直接取得していない"
  - "Goose にサンドボックスがあるか、Pi の containerization.md 本文、antirez / Thorsten Ball / Kent Beck の立場は確認できず"
  - "Anthropic が引用する承認疲れの Reddit スレッド（本文取得不可）と Apollo Research の pilot（該当記事を特定できず）"
  - "Gemini CLI の policy-engine の tier 番号は、同ページの表と節の例が一つずれている（どちらが正か未解決）"
sources_note: "本文は英語（引用を原文のまま保つため）。全ての URL は 2026-09-27 に直接取得。TRANSCRIBED は第三者（主に Simon Willison の weblog）が原文とリンクを再掲しているもの。参照はパスで行い番号 ID は使わない。"
---

# How practitioners and companies gate coding agents: yolo, sandbox, allowlists, or prompts

**Research date:** 2026-09-27. **Slice:** lens 2 of the four-lens rule (named practitioners) plus published company practice, with the product-level facts needed to read those practitioners' statements in context.

**Revision 2 (2026-09-27, after this record was first collected):** two defaults were corrected on verification. Amp was drafted as prompt-per-tool and is not — "By default, Amp does not ask for approval before running tools." Crush was drafted as unverified and is not — "By default, Crush will ask you for permission before running tool calls." The "code-execution surface" section of the synthesis was added, and the not-verified list went from 16 items to 15; the front-matter unverified list no longer names Crush, since this revision verified it.

## Method and verification legend

- **DIRECT** — the page was fetched by this research chain during this session (reader-mode / Markdown twin / native HTML / GitHub API). Reader-mode and native HTML conversions can drop page furniture, so absence of a phrase on such a page is weaker evidence than presence.
- **TRANSCRIBED** — the quote is reproduced by a third party whose page I fetched directly (in practice: Simon Willison's weblog, which quotes and links the canonical URL). The canonical URL is always given; I did not fetch it myself for the entries marked this way.
- **UNREACHABLE** — could not be fetched. "Not found" means *not reachable*, not *absent*.

Discovery constraint: `web_search` was unavailable from this egress for the whole session (all providers blocked). Every source below was reached by direct `read` on a URL. Where a site exposes a Markdown twin (`.md` suffix, or auto-negotiated Markdown), that twin is what was fetched.

Two caveats stated up front, because they bound every conclusion:

1. Practitioner statements about *their own* approval posture are self-reports. Nobody publishes their incident log. Where a named practitioner has a commercial interest (Yegge → Sourcegraph/Droid; Horthy → HumanLayer; Ball and Hashimoto → Amp; Zechner → Pi), that is flagged.
2. Vendor documentation describes defaults, and vendors with an interest in adoption have an interest in low-friction defaults. Every default below is quoted from the vendor's own docs with the date on the page.

---

# Part 1 — Products: does it execute code, what is the default gate, where does it run

The four fields requested: (1) code-exec/interpreter surface, (2) default approval behaviour for that surface, (3) isolation boundary or host execution, (4) the vendor's stated position on rule-based gating versus an isolation boundary.

## Anthropic / Claude Code (DIRECT: `code.claude.com/docs/en/permission-modes`, `/docs/en/sandboxing` — Markdown twins, fetched 2026-09-27, docs version v2.1.283-era)

**1. Exec surface.** Bash, PowerShell, and Monitor commands plus file edit tools. Anthropic's own auto-mode post treats user-written interpreter rules as functionally equivalent to blanket shell access (quoted below).

**2. Default approval behaviour — this is the single most important vendor datum in the report, because it *changed*, and the current docs say so.** Modes and what runs unprompted (`https://code.claude.com/docs/en/permission-modes`):

| Mode | "What runs without asking" (verbatim) | "Best for" (verbatim) |
|---|---|---|
| `default` (labelled **Manual**) | "Reads only" | "Reviewing every action yourself, sensitive work" |
| `acceptEdits` | "Reads, file edits, and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`, etc.)" | "Iterating on code you're reviewing" |
| `plan` | "Reads, plus classifier-approved commands when auto mode is available" | "Exploring a codebase before changing it" |
| `auto` | "Everything, with background safety checks" | "Long tasks, reducing prompt fatigue" |
| `dontAsk` | "Reads and pre-approved tools; anything that would prompt is denied" | "Locked-down CI and scripts" |
| `bypassPermissions` | "Everything" | "**Isolated containers and VMs only**" |

> "With Claude Code v2.1.283 or later, auto mode is the built-in starting permission mode for interactive terminal and VS Code sessions. On earlier versions, it's the built-in starting permission mode only on Pro, Max, and Team plans."

> "`claude -p` or the [Agent SDK] | `default`" (from the built-in-starting-mode table — headless runs still start in Manual)

So the default is *not uniform*: interactive terminal/VS Code sessions now start in `auto`; `-p`/Agent SDK runs start in Manual; and the older vendor posts quoted below describe the pre-v2.1.283 world. There are also actions that no mode auto-approves, including `rm`/`rmdir` targeting a critical path, explicit ask rules, and — when `permissions.blockReadsOutsideWorkingDirectories` is on — reads outside the working directories. And the rules layer still outranks the mode: "Deny rules block in every mode, including `bypassPermissions`."

Bypass is deliberately constrained, which is the clearest evidence that Anthropic treats it as an *isolation* mode rather than a convenience mode:
> "On Linux and macOS, Claude Code refuses to start in this mode when running as root or under `sudo`:" / "`--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`"
and the first-run warning: "Claude Code shows a warning dialog asking you to accept responsibility for actions taken without permission checks."

The same page's "Common setups" table states the isolation requirement per goal, and it is the most decision-relevant artefact in the whole report:
- "Review every action yourself" → Isolation needed: "None"
- "Iterate locally with fewer prompts, **without a classifier**" → Manual mode plus the Bash sandbox in the sandbox's auto-allow mode; Isolation: "The built-in Bash sandbox, on macOS, Linux, and WSL2"
- "Work hands-off in auto mode" → Isolation: "**None; a sandbox or container adds defense in depth**"
- "Run fully unattended inside a container" → `claude -p "<prompt>" --dangerously-skip-permissions`; Isolation: "**Required**: a container, VM, or the sandbox runtime; on Linux and macOS, run it as a [non-root user]"

**3. Isolation.** The docs rank the two mechanisms and describe what the sandbox actually buys (`https://code.claude.com/docs/en/sandboxing`):
> "The Bash sandbox lets Claude run most shell commands without stopping to ask permission. Instead of approving each command, you define which files and network domains commands can touch, and the operating system enforces that boundary for every Bash, PowerShell, or Monitor command and its child processes."

> "`autoAllowBashIfSandboxed` still defaults to `true`, so sandboxed commands keep running without prompts."

> "Sandboxing reduces risk but is not a complete isolation boundary."

The honest limits, in the vendor's own words: reads default to the whole computer — "this default still allows reading credential files such as `~/.aws/credentials` and `~/.ssh/`", and "There is no built-in credential deny list"; network access pre-allows nothing but the proxy "does not terminate or inspect TLS on outbound traffic", with domain fronting named as an exfiltration path; the Linux `enableWeakerNestedSandbox` "considerably weakens security".

**4. Stated position — rules versus boundary, stated as a designed division of labour:**
> "Claude Code evaluates permission decisions before a command runs, based on the command string and, in auto mode, a separate classifier's judgment about whether the command is safe. The operating system enforces the sandbox boundary on the running process, so it holds regardless of what the model chose to run and even if an allowed command does more than its name suggests."

**Historical vendor posts, still relevant for the *numbers*:**
- `https://www.anthropic.com/news/measuring-agent-autonomy` (18 Feb 2026): "Claude Code's default settings require users to manually approve each action." → "roughly 20% of sessions use full auto-approve, which increases to over 40% as users gain experience."
- `https://www.anthropic.com/engineering/claude-code-auto-mode` (25 Mar 2026): "we drop permission rules that are known to grant arbitrary code execution, including blanket shell access, wildcarded script interpreters (python, node, ruby, and similar), and package manager run commands."
- `https://www.anthropic.com/engineering/how-we-contain-claude` (25 May 2026): "Our telemetry showed users approved roughly 93% of permission prompts." / "Our custom allowlist proxy was the piece that failed." / "Claude Code, run locally, uses Seatbelt on macOS and Bubblewrap on Linux." / auto mode footnote: "roughly 0.4% of benign commands blocked... (~17% of overeager actions get through)."
- `https://claude.com/blog/auto-mode-default-in-claude-code` (7 Aug 2026): "Starting on August 14, new sessions on Pro, Max, and Team plans will run in auto mode." / "users approve 97% of permission prompts" / "49.5% of active CLI users have manually created a Bash allow-rule—5% allow any shell command outright, and another 43% have interpreter rules like `Bash(python:*)` or `Bash(node:*)` that are essentially equivalent in practice—and that share is growing roughly 5 percentage points every 5 weeks." / "62% of users have used `bypassPermissions`..." / with 1,053 paid testers: "they blocked about 17% of dangerous commands early in a session, dropping to about 5% after 50 or more prior prompts, while auto mode's block rate stayed flat" / "6.3% of manually approved sessions contained a harmful action... compared to 2.4% of auto mode sessions."
- `https://code.claude.com/docs/en/auto-mode-config`: the classifier is configurable via `autoMode.environment/allow/soft_deny/hard_deny/classifyAllShell` with a `"$defaults"` splice; "The classifier doesn't read `autoMode` from project settings..."
- At the AI Engineer World's Fair fireside chat, transcribed at `https://simonwillison.net/2026/Jul/21/cat-and-thariq/` (TRANSCRIBED, 21 Jul 2026), Cat Wu: "Broadly within Anthropic, almost every single person uses auto mode."

## OpenAI / Codex (DIRECT: `learn.chatgpt.com/docs/permission-modes`, `/docs/sandboxing`)

**1. Exec surface.** Local shell plus file edits. "Permissions control how ChatGPT (in the desktop app) and Codex (in the CLI or IDE) handle local actions."

**2. Default approval behaviour.** Two controls, named: "Two controls work together: The **sandbox** defines which files and network resources ChatGPT can access. **Approvals** determine when ChatGPT pauses before an action or sends the request to automatic review." `workspace-write` is described as "the default low-friction mode"; approval policies are `on-request` and `never` ("Codex and ChatGPT Work no longer support `untrusted` as a selectable approval policy."); `approvals_reviewer` is `user` (default) or `auto_review`; CLI flags are `--sandbox workspace-write --ask-for-approval on-request`. Full bypass is explicit: "Full access means using `sandbox_mode = "danger-full-access"` together with `approval_policy = "never"`."

**3. Isolation.** Default-on and OS-level: "On **macOS**, sandboxing works out of the box using the built-in Seatbelt framework." / "On **Linux and WSL2**, install `bubblewrap` with your package manager first".

**4. Stated position — the cleanest vendor sentence in the corpus for "boundary first, prompts second":** "Changing who reviews a request doesn't expand the sandbox." And the design rationale: "The sandbox reduces approval fatigue. Instead of asking you to confirm every low-risk command, the agent can read files, make edits, and run routine project commands within the boundary you already approved." This is the opposite ordering from Claude Code's *default* (auto mode on, sandbox optional "defense in depth"), and the two companies ship the same product category.

**Company practice, published:** `https://developers.openai.com/blog/codex-at-devday.md` (DIRECT) describes internal OpenAI usage, not policy — and contains *no* mention of approvals or sandboxing while describing very high parallelism:
- "Romain was able to work on both problems in parallel and have an initial version up and running in an afternoon without having to touch the keyboard"
- "he had seven (!) different terminals open, each with an instance of Codex CLI working on one single-file Phaser game implementation"
- "Often you would see us run 3-4 completely independent tasks at the same time."
By contrast `https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex.md` (DIRECT) is written by an engineer who keeps a human checkpoint, quoting his own notebook goal verbatim: "Wait for me to review and approve the plan before beginning." and "I still decide when a plan is ready when a consequential choice needs human judgment." The mechanism he relies on: "automatic approval review can review eligible actions without changing the existing permission boundaries."

## Google / Gemini CLI → Antigravity CLI (DIRECT: `geminicli.com/docs/*`, `developers.googleblog.com`)

**1. Exec surface.** A `run_shell_command` tool governed by a policy engine with per-rule `toolName`, `commandPrefix`, `argsPattern`, `decision` (`allow` / `deny` / `ask_user`) and numeric priority across tiers (Default 1, Extension 2, Workspace 3 — "**(Currently disabled)**", User 4, Admin 5). `https://geminicli.com/docs/reference/policy-engine/` (doc page dated Apr 17 2026).

**2. Default approval behaviour.** Per-mode, and the doc names the escape hatch plainly: approval modes are `default` ("The standard interactive mode where most write tools require confirmation."), `autoEdit`, `plan`, and `yolo` — "`yolo`: A mode where all tools are auto-approved (use with extreme caution)." Approval persistence is mode-aware: an approval granted in `default` applies to `default`, `autoEdit`, and `yolo`. Headless runs treat `ask_user` as `deny`.

**3. Isolation.** Opt-in, per `https://geminicli.com/docs/cli/sandbox/`: "You can enable sandboxing using a command flag, environment variable, or configuration file" (`gemini -s`, `GEMINI_SANDBOX=true|docker|podman|sandbox-exec|runsc|lxc`, `{"tools": {"sandbox": "docker"}}`). Methods: macOS Seatbelt ("**Default profile**: `permissive-open` - denies operations by default; confines writes to the project directory while allowing broad file reads and network access"), Docker/Podman containers (cwd mounted at the same absolute path as the host), and a Windows sandbox using `icacls` that leaves persistent low-integrity marks on files.

**4. Stated position.** Google ships *both* camps side by side. Rule-based: the policy engine. Trust-boundary-as-gate: `https://geminicli.com/docs/cli/trusted-folders/` — the feature is "**disabled by default**", and when a folder is untrusted: "**Tool auto-acceptance is disabled**: You will always be prompted before any tool is run, even if you have auto-acceptance enabled globally." Headless runs then fail outright (`FatalUntrustedWorkspaceError`) unless `--skip-trust` or `GEMINI_CLI_TRUST_WORKSPACE=true` is set.

**A 2026 state change that matters:** `https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/` (19 May 2026) — "On June 18, 2026, Gemini CLI and Gemini Code Assist IDE extensions will stop serving requests for Google AI Pro and Ultra, as well as those using it free of charge...". Enterprise licences keep Gemini CLI; the geminicli.com docs root still carries the deprecation banner as of this session.

## Sourcegraph / Amp (DIRECT: `ampcode.com/docs/tools` modified 2026-09-14, `ampcode.com/docs/customize/mcp` modified 2026-09-21, `ampcode.com/docs/plugin-api` 2,669 lines, `ampcode.com/docs/orbs` modified 2026-09-14, `ampcode.com/notes/permissions` modified 2026-08-05)

**1. Exec surface.** Shell commands, file edits, and a genuine **code-exec** surface rather than a plain shell tool. `https://ampcode.com/docs/customize/mcp`: "Amp discovers saved remote MCP tools with `tool_search` and calls them through `code_exec`." The plugin reference confirms the mechanism is the intended path for all discovered tools: "They are named in the agent's rendered instructions so the model knows to reach them through code mode (`tool_search`/`code_exec`)." Execution is on the host: the Orbs page defines the alternative as "remote machines where Amp agents work **without using your computer**."

**2. Default approval behaviour — no approval at all; that is the vendor's stated default, printed twice on one page.** `https://ampcode.com/docs/tools`:
> "Amp runs tools and shell commands on your behalf to inspect code, run tests, and iterate quickly."
> "By default, Amp does not ask for approval before running tools."

and again under its own **Permissions** heading:
> "Amp does not ask for approval before running tools."
> "Use a [custom plugin] to control tool use. Workspace admins can distribute it as a [global workspace plugin]."

The `ask`/`allow`/`deny` rule language and the `amp permissions edit` recipe on the notes page are the **opt-in** layer on top of that default — the notes page's own example is the configuration a user writes *to obtain* prompts for a few destructive patterns. Exactly one narrow approval gate ships, and it is about untrusted *configuration* rather than about commands: "MCP servers in workspace settings (`.amp/settings.json`) require explicit approval before they can run. This prevents untrusted code from executing automatically when you open a project." (`amp mcp approve`; global-config MCP servers "do not require approval").

**3. Isolation.** None in-process. Isolation is out-of-process and elective via Orbs, presented in the docs first as a convenience ("An agent in an orb keeps working while your laptop is closed... a sleeping orb costs nothing") with burst pacing of 20 metered orbs, then one new orb every five minutes.

**4. Stated position — rules are the user's job, and untrusted input is a boundary problem.** The vendor's own warning points at isolation:
> "Amp acts on content in your workspace. Untrusted repositories, MCP servers, and other external inputs can influence what Amp does. If you regularly work with untrusted sources, consider creating a custom policy plugin, or using an isolated development environment."

Gating is therefore delegated: a `tool.call` plugin hook returning `{ action: 'allow' }` or `{ action: 'reject-and-continue' }`, an OPA/server-side policy integration, or nothing at all. The notes page supplies the rationale for the no-default-gate choice:
- "In our experience, agents work best when they can get feedback about the changes they are making."
- "Taking tools away, like preventing the agent from reading certain files, makes the agent look for an alternative, like running a Bash command instead to access file contents."
- "Most people do not worry about file edits anymore, because Git makes the cost of a wrong edit negligible."
- "We have observed there being two kinds of operators: risk-tolerant ones using frontier agents all day, often running multiple instances at the same time; and cautious users who like to stay in control, carefully reviewing every step the agent takes. Both groups' needs are valid"


**The rule language matches source text, which the vendor says out loud.** The notes page's worked example is worth reproducing, because it shows exactly what a rule can see. Rule resolution is ordered and first-match-wins: "Before performing *any* tool call, Amp checks all permission rules in sequence until it finds a matching rule." And the matcher operates on the command *string*:

> "The `Bash` tool accepts the entire shell command pipeline to run in the `cmd` parameter. This is a string containing source code, so we need match any command line that *looks* like a git push command"

The page then demonstrates the consequence for `ask Bash --cmd '*git*push*'`: "The `*` is a wildcard, so this rule will match all of these command lines" — "`cd ../other-repo && git push`", "`git commit -m 'WIP' && git push`", "`git --work-tree=. push origin`". Anything subtler is handed to a program (`amp permissions add delegate --to amp-permissions-helper '*'`), where "The program receives the tool parameters on stdin as JSON, and makes a decision with its exit code: `0` allows the tool call, `1` makes Amp ask, and `2` rejects the tool call, forwarding stderr to the model", or to an OPA server. The notes page also states the flip side of the no-gate default: "Restrictions aren't necessary for tools like this with an easy undo action."

**Company practice, published:** `https://ampcode.com/notes/thats-not-soc-2-compliant` (13 Aug 2026) — Amp pushes to `main` with no pull requests, deliberately, from the first commit; the controls their auditors accepted were "Restricted push access", "Signed commits", "Automated CI", and "An audit trail that's as good as a PR's"; and: "And no, code review isn't on the list. The criteria don't say a second human has to stare at a diff." With the scale caveat: "But we're not going to pretend a 2,000-person company should let everyone push to main." And `https://ampcode.com/news/less-noise` (25 Sep 2026): "If you have the patience to watch your agents work, you're giving them too short a leash."

## Block/Goose → Agentic AI Foundation (DIRECT: `goose-docs.ai`)

**1. Exec surface.** The Developer extension ships enabled by default and provides shell and file tools.
**2. Default approval behaviour — the inverse of Claude Code's Manual floor.** `https://goose-docs.ai/docs/getting-started/using-extensions/`: "**goose operates autonomously by default.** Combined with the Developer extension's tools, this means goose can execute commands and modify files without your approval." The four modes are Completely Autonomous / Manual Approval / Smart Approval / Chat Only; the permissions page repeats the default: "`Autonomous Mode` is applied by default." (`https://goose-docs.ai/docs/guides/managing-tools/goose-permissions`)
**3. Isolation.** Not documented on the pages fetched. No sandbox claim was found; treat as on-host until shown otherwise.
**4. Stated position.** Gating is by mode, not by boundary; the vendor's compensating control is supply-chain — "goose automatically checks external extensions for known malware before activation". Institutional note: goose moved to the Agentic AI Foundation (`https://goose-docs.ai/blog/2026/04/07/goose-moves-to-aaif`, 7 Apr 2026).

## Charm / Crush (DIRECT: `raw.githubusercontent.com/charmbracelet/crush/main/README.md` 1,055 lines and `.../docs/config/README.md` 645 lines, both fetched 2026-09-27)

**1. Exec surface.** A Bash tool — and the config file *is* Bash: `~/.config/crush/crushrc`.

**2. Default approval behaviour — the only product surveyed whose documented default is a prompt.** From the README:
> "By default, Crush will ask you for permission before running tool calls. If you'd like, you can allow tools to be executed without prompting you for permissions. Use this with care."

and the two documented ways out, on the same page:
> "You can also skip all permission prompts completely by running Crush with the `--yolo` flag. Be very, very careful with this feature."

Per-tool lists come from the config reference: "Configure tool permissions. `allow` skips approval prompts; `deny` hides tools from the agent entirely." (`permissions allow view ls grep edit`, `permissions deny bash`; the top-of-file example is commented "# Auto-approve some tools."). The gate is delivered as an interruption the user is expected to be *at the machine* for: "Crush sends desktop notifications when a tool call requires permission and when the agent finishes its turn. They're only sent when the terminal window isn't focused _and_ your terminal supports reporting the focus state." `--yolo` is also process-wide and sticky per workspace: "The first client to create a workspace fixes its process-wide flags. In particular, `--yolo` and `--debug` follow a **first-wins** rule: later clients that arrive at the same `--cwd` with different values for those flags do not change the running workspace."

**3. Isolation.** None documented.

**4. Stated position.** Trust-the-config-file: "Just like `crush.json`, `crushrc` is a trusted file. Guard it carefully and don't download random configs without reading them first."

## Pi / earendil-works (DIRECT: GitHub API, `github.com/badlogic/pi-mono` → `earendil-works/pi`, 109,686 stars, fetched 2026-09-27)

The most explicit "we deliberately ship no gate" statement from any product surveyed, and it is one line of README:

> "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it."

> "If you need stronger boundaries, containerize or sandbox Pi."

The same README points to `packages/coding-agent/docs/containerization.md` for three patterns: a "Gondolin extension" that keeps auth on the host and routes built-in tools into a local Linux micro-VM, plain Docker, or OpenShell. Pi is also the tool behind Shopify's CEO's autoresearch run (Part 3). The repo has moved from `badlogic/pi-mono` to `earendil-works/pi`.

---

# Part 2 — Named practitioners, in their own words

Twelve names were surveyed against the same four questions. Three of them — Thorsten Ball, antirez, and Kent Beck — yielded **no** gating statement at all, which is recorded below as an explicit negative rather than filled in with inference.

## Simon Willison — "always yolo, but do it in a sandbox" (the most-cited position)

The position that most of this debate orbits is a single post: `https://simonwillison.net/2025/Oct/22/living-dangerously-with-claude/` (22 Oct 2025, TRANSCRIBED via the `claude-code` tag page):
> "Why you should *always* use `--dangerously-skip-permissions`."
> "The only solution that's credible is to **run coding agents in a sandbox**."
> "Go forth and live dangerously! (But do it in a sandbox.)"

Note the shape of the claim: it is *not* an argument for prompts, and *not* an argument for allowlists. It is "remove the prompts, and move the boundary to the sandbox." Nine months later he states the anti-allowlist case directly (`https://simonwillison.net/tags/sandboxing/`, 18 Mar 2026, TRANSCRIBED):
> "I've seen allow-lists against command patterns like this in a bunch of different agent tools and I don't trust them at all - they feel inherently unreliable to me."

He also names prompt fatigue as a fact, not a hypothesis (`https://simonwillison.net/2026/Aug/8/auto-mode/`, DIRECT, 8 Aug 2026):
> "I absolutely buy that auto mode is a better solution than asking humans to constantly approve actions. Confirmation fatigue is real, and asking humans to click "OK" every few steps is clearly not going to result in safe behavior."

And he declines to treat the vendor's classifier as the end state (same post):
> "I'm personally inspired to double down on figuring out a productive way to run agents such that they don't have access to data or tools that can cause harm if triggered in the wrong way."

**Posture:** bypass prompts; sandbox the agent. **Rules vs isolation:** isolation, unambiguously, and he treats allowlists as security theatre. Bias: he is a security-focused commentator with a long-running "lethal trifecta" thesis that this year's numbers are meant to test — his position is not neutral between the two options.

## Armin Ronacher — yolo, with Docker as the compensating control

`https://lucumr.pocoo.org/2025/6/12/agentic-coding/` (12 Jun 2025, TRANSCRIBED):
> "I disable all permission checks... I have an alias called `claude-yolo` set up."
> "you can manage those risks with moving your dev env into docker."

**Posture:** bypass prompts; containerise. Same shape as Willison, reached independently, one week earlier. **Rules vs isolation:** isolation (the container), not rules.

## Steve Yegge — yolo, then a production-database incident, then a public reversal

The most useful datum in this survey is not a position, it is a **cost**: `https://x.com/steve_yegge/status/1946360175339974807` (19 Jul 2025, TRANSCRIBED):
> "So one of my favorite things to do is give my coding agents more and more permissions and freedom... I haven't given them direct access to my bank account yet. But I did give one access to my Google Cloud production instances and systems."
> "It promptly wiped a production database password and locked my network."
> "Running them with permission checks disabled is dangerous and stupid, and you should only do it if you are willing to take dangerous and stupid risks with your code and/or production systems."

That is a named failure mode with a concrete blast radius, published by the person who ran the experiment. It is also the only *retraction* in the corpus: an advocate of maximum access describing what maximum access cost him.

Downstream, his failure modes have moved from permissions to *sustained agent loops*: `https://yegge.ai/essays/the-shape-of-things-to-come/` (4 Aug 2026, TRANSCRIBED) reports that a long-running autonomous system "fell apart at the seams" on a model upgrade. Bias: Yegge sells an agent product (Sourcegraph/Droid) and is the most-cited practitioner-advocate of running many agents at once, so read the yolo position as commercially aligned and the incident report as unusually candid.

## Geoffrey Huntley — "Ralph", i.e. no cap on tool calls at all

The technique that names this whole debate: `https://ghuntley.com/ralph/` (published 14 Jul 2025, page last modified 19 Feb 2026, DIRECT):
> "In its purest form, Ralph is a Bash loop: `while :; do cat PROMPT.md | claude-code ; done`"
> "Ralph can be done with any tool that does not cap tool calls and usage."
> "This is full hands-off vibe coding that will test the bounds of what you consider 'responsible engineering'."

The cost claim attached to the post, from a contractor's iMessage reproduced with permission:
> "Cost of a $50k USD contract, delivered, MVP, tested + reviewed with @ampcode. $297 USD."

**Posture:** no approval gate at all — the technique is *defined* by the absence of a cap on tool calls, run in a `while` loop overnight. **Sandbox posture:** none stated anywhere in the post. **Rules vs isolation:** rejected in favour of *backpressure* — the enclosing gates are a fast test suite, a static analyser, an `AGENTS.md`-style standard library, and "one item per loop", not approvals. His framing: "the technique is deterministically bad in an undeterministic world." Bias: he is a freelance consultant whose public reputation is built on this technique, and his evidence is single-operator self-report.

## Dex Horthy — the vendor-versus-practice split, and a documented runtime failure

Horthy's written practice (`https://www.humanlayer.dev/blog/brief-history-of-ralph`, 6 Jan 2026, TRANSCRIBED) is unambiguous about the flag being load-bearing, including for *Anthropic's own* attempt to productise the pattern:
> "It dies in cryptic ways unless you have `--dangerously-skip-permissions`."
> "I'll keep my 5-line bash loops."

His 12-factor framework (`https://www.humanlayer.dev/blog/12-factor-agents`, 3 Apr 2025, DIRECT) is the origin of "contact humans on tool calls" — Factor 7 is titled exactly that, and the page is explicit that a *resumable* pause between tool **selection** and tool **invocation** is the prerequisite for any approval gate:
> "the number one feature request I have for every AI framework out there is we need to be able to interrupt a working agent and resume later, ESPECIALLY between the moment of tool **selection** and the moment of tool **invocation**."

and it names the three-way trap that every tool in Part 1 is choosing between:
> "you're forced to either: 1. Pause the task in memory while waiting for the long-running thing to complete... 2. Restrict the agent to only low-stakes, low-risk calls like research and summarization 3. Give the agent access to do bigger, more useful things, and just yolo hope it doesn't screw up"

**Reconciliation, stated explicitly so it is not conflated:** Factor 7 is about what to *build for customers*. His own day-to-day is the 5-line loop with permission checks off. The framework and the practice point in opposite directions, and both are his.

## Mitchell Hashimoto — the gate is the harness, not the prompt

`https://mitchellh.com/writing/my-ai-adoption-journey` (5 Feb 2026, DIRECT, 311 lines, first 300 read; the remainder is footnotes). His whole progression has **no** approval-prompt or sandbox step, which is itself the finding — he uses Claude Code and Amp; as of the post's date, Claude Code's default was Manual mode, and Amp gates every tool call by rule:

- Step 1: "Immediately cease trying to perform meaningful work via a chatbot."
- Step 3: "To be clear, I did not go as far as others went to have agents running in loops all night."
- Step 4, the operationally load-bearing quote: "**Very important at this stage: turn off agent desktop notifications.** Context switching is very expensive. In order to remain efficient, I found that it was my job as a human to be in control of when I interrupt the agent, not the other way around. Don't let the agent notify you." — an explicit rejection of event-driven human interruption, which is the mechanism a prompt-per-action gate *is*.
- Step 5, where the gating actually lives: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again", implemented as `AGENTS.md` entries and purpose-built verification tools. "**This is where I'm at today.**"
- Step 6: "**I'm not [yet?] running multiple agents, and currently don't really want to.**"
- On triage agents: "I would NOT allow agents to respond, I just wanted reports the next day".

**Posture:** no stated policy on the tool's permission prompts; the gate is a harness the agent can be trusted against. **Rules vs isolation:** a third category — *verification*, not gating. Bias: he is an experienced tool-builder (Vagrant, Terraform, Ghostty) whose method is literally "invest effort until the tool is good", and he states he has no commercial stake in AI ("I have no skin in the game here").

## Jesse Vincent — process isolation between agents, review as the gate

`https://blog.fsck.com/2025/10/05/how-im-using-coding-agents-in-september-2025.md` (5 Oct 2025, DIRECT) and `https://blog.fsck.com/2025/10/09/superpowers/` (9 Oct 2025, DIRECT). Neither post mentions permission prompts, bypass flags, or sandboxing. What he actually does:

- Filesystem isolation per task: "When I want to start a new task on an existing project, I try to always use a git worktree to isolate that work from other tasks. This is increasingly important for me, because I find myself frequently running 3-4 parallel projects on a single codebase."
- Two-role review: an "architect" session reviews the "implementer" session's work; the implementer is told "DO NOT DEVIATE FROM THE PLAN."
- Deliberate suspension of trust in automated reviewers: "our robot buddies are quite credulous. If you paste in a list of instructions for how to update a codebase, Claude's just going to take you at your word and make the changes, even if what you're asking for is crazy and wrong." His fix is a role-play prompt that asks the agent to *vet the reviewer* ("1) should we hire this reviewer").

**Posture:** no permission-gating statement found. **Rules vs isolation:** git worktrees + a mandated plan + review; the agent is not fenced from the machine, it is fenced from *other tasks*. Explicit negative: **no** yolo/bypass/sandbox statement exists in either post.

## Mario Zechner — ships a harness whose stated design is "no permission system"

Product side is in Part 1. On his own prose: `https://mariozechner.at/posts/2025-11-30-pi-coding-agent/` was read only partially this session; the load-bearing statement for this decision is the Pi README (quoted in Part 1), which is a vendor-author's explicit refusal to build a gate and an explicit instruction to containerise instead. **Do not attribute a yolo *recommendation* to him** — the README's position is "no gate, and it is your job to isolate."

## Thorsten Ball — no gating statement found

Ball's published practice index is `https://registerspill.thorstenball.com/archive` (DIRECT, 306 lines); the recent entries are weekly link roundups ("Joy & Curiosity #91–#101", Jul–26 Sep 2026) and one essay, "Ownership" (8 Jul 2026, described on the archive as "Thoughts on ownership I sent to the Amp team in internal note"). His 19 Sep 2026 post at `https://thorstenball.com/blog/2026/09/19/what-i-believe-about-the-future-of-software-development/` is about which parts of software engineering survive, not about permissions. **Explicit negative: no statement found in which he describes his own approval, sandbox, or allowlist practice.** He writes for Amp's blog, so any future statement on this topic should be read as vendor-adjacent.

## Andrej Karpathy — containers, not prompts

`https://twitter.com/karpathy/status/2024987174077432126` (21 Feb 2026, TRANSCRIBED):
> "I'm definitely a bit sus'd to run OpenClaw specifically"
> "on a quick skim **NanoClaw** looks really interesting in that the core engine is ~4000 lines of code (fits into both my head and that of AI agents, so it feels manageable, auditable, flexible, etc.) and **runs everything in containers by default**."

The emphasis on *containerised by default* as the attractive property is the position: he selects tools by their isolation boundary. His adoption timeline from the same tag (`https://twitter.com/karpathy/status/2026731645169185220`, 26 Feb 2026, TRANSCRIBED) — "coding agents basically didn't work before December and basically work since" — matters for dating any practitioner report: positions before Dec 2025 were formed against materially weaker agents. **Explicit negative: no statement on allowlists or approval prompts found.**

## antirez (Salvatore Sanfilippo) — no gating statement found

Checked: `https://antirez.com/news/154` (21 Jul 2025), `/news/158` (11 Jan 2026), `/news/164` (4 May 2026), and the Hacker News thread `https://news.ycombinator.com/item?id=46670279#46671233`. **No approval, sandbox, or allowlist statement was found.** Recorded as an explicit negative; nothing here should be read as a position for or against gating.

## Kent Beck — not surveyed

No primary source was reached this session. Listed in the not-verified section rather than summarised.

---

# Part 3 — Published company practice

What companies *say they do*, as opposed to what their docs ship. Six organisations published enough to be cited.

## Cloudflare — the gate is tests and CI, and the post never mentions permissions

`https://blog.cloudflare.com/vinext/` (DIRECT; content-negotiated Markdown). Cloudflare rebuilt a Next.js-compatible toolchain with agents and wrote it up:
> "**Almost every line of code in vinext was written by AI.**"
> "Over the course of the project, we ran over 800 sessions in OpenCode. Total cost: roughly $1,100 in Claude API tokens."
> "**Next.js has an elaborate test suite.** ... This gave us a specification we could verify against mechanically."
> "**Establishing a set of good guardrails is critical to making AI productive in a codebase.**"
> "It didn't work perfectly every time. There were PRs that were just wrong."

And the human-cost claim: "This project would normally take a team of engineers months... This time we did it in under a week. One engineer (technically engineering manager) directing AI."

**Explicit negative, and it is a strong signal:** across the post there is **no** statement about permission prompts, approval modes, bypass flags, or sandboxing. A team publishing a deliberate "we let agents write everything" case study chose to describe its guardrails as tests, CI, and mechanical verification. 800 sessions at ~$1,100 implies roughly $1.40 of tokens per session — a low per-session cost consistent with short, bounded, test-gated tasks, but Cloudflare does not publish the split between input/output tokens or how many of the sessions were reviewed by a human.

## Shopify — the gate is an autoresearch loop plus an enormous test suite, and the CEO's own PR is the artefact

`https://shopify.engineering/back-to-native` (10 Sep 2026, TRANSCRIBED) states the change in kind rather than degree; the era it describes ending is "our five-year rust-rewrite program", and the driver named is that agent capability, not cost:
> "What changed is that agents can now do enough of the implementation, translation, testing, and review work that it's no longer the deciding factor it was in 2020."

The concrete artefact is a public pull request against Shopify's own flagship library, `https://github.com/Shopify/liquid/pull/2056` (13 Mar 2026, DIRECT via GitHub): "93 commits from around 120 automated experiments", gated by "974 unit tests" (92.29% line coverage, 88% branch coverage per the PR body), produced with Mario Zechner's Pi plus a `pi-autoresearch` driver logging each experiment to `autoresearch.jsonl`. The same commit is publicly attributed to Shopify's CEO, who has separately stated that the *River* agent is confined to public Slack channels (11 May 2026) — a channel-and-surface restriction, not a permission-prompt regime. No permission-prompt, approval-mode, or sandbox claim appears in either source.

## StrongDM — the "dark factory": no human in the loop at all

`https://simonwillison.net/2026/Feb/7/software-factory/` (7 Feb 2026, TRANSCRIBED from the team's primary page, which is JS-rendered and was **not** reachable in plain text). The team is three people (Justin McCarthy, Jay Taylor, Navan Chauhan), formed July 2025. Verbatim, as reproduced:
> "We built a **Software Factory**: non-interactive development where specs + scenarios drive agents that write code, run harnesses, and converge **without human review**."
> "Code **must not be** written by humans"
> "Code **must not be** reviewed by humans"
> "If you haven't spent at least **$1,000 on tokens today** per human engineer, your software factory has room for improvement"

Their convergence criterion is stated as probabilistic, not boolean: "we transitioned from boolean definitions of success ('the test suite is green') to a probabilistic and empirical one". The substitutability problem is solved with a "**Digital Twin Universe**: behavioral clones of the third-party services our software depends on... Okta, Jira, Slack, Google Docs, Google Drive, and Google Sheets". Related public artefacts: `https://github.com/strongdm/attractor` (the repo contains "no code at all—just three markdown files") and `https://github.com/strongdm/cxdb`.

This is the far end of the axis: not "yolo with a sandbox", but "yolo with no reviewer, in a replicated environment, measured statistically". It is also the weakest-evidenced entry in this report — see the not-verified list.

## Inside the vendors themselves

- **Anthropic** (TRANSCRIBED, 21 Jul 2026): Cat Wu, at a public fireside chat — "Broadly within Anthropic, almost every single person uses auto mode." A vendor whose internal practice is the very mode it now ships as the default; treat as both a data point and a marketing statement.
- **OpenAI** — internal posts disagree by team, which is itself informative. The DevDay post describes seven concurrent Codex CLIs and "3-4 completely independent tasks at the same time" with no mention of approvals; the automation post describes a plan gate with "Wait for me to review and approve the plan before beginning." Same company, same quarter, opposite postures — evidence that "company practice" is not monolithic even inside one lab.
- **Google** — the internal-usage figure in circulation ("Over 40K SWEs use agentic coding weekly here") comes from a public dispute, not a Google document: Addy Osmani replying to Steve Yegge's claim that Google's adoption matched a tractor manufacturer's, with Demis Hassabis adding "This post is completely false and just pure clickbait." TRANSCRIBED via `https://simonwillison.net/tags/steve-yegge/` (13 Apr 2026); the canonical tweets were not fetched. Neither reply states an approval or sandbox policy.

---

# Summary table

`Gate type` is the operative control the source describes. `Task type` distinguishes whether the evidence concerns production code, research/greenfield, or an overnight loop, because a research-task result is not a coding-task result.

| Source | Date | Task type | Gate type | Named approval/sandbox default | Cost numbers | Named failure modes |
|---|---|---|---|---|---|---|
| Claude Code (Anthropic docs) | 2026-02-18 → 2026-08-14 | production code, interactive | classifier (auto mode); was prompt-per-action | interactive sessions start in `auto` at v2.1.283+; auto was Pro/Max/Team-wide from 14 Aug 2026; `-p`/SDK still start Manual; Seatbelt/Bubblewrap shipped; `bypassPermissions` refused as root/sudo | — | allowlist proxy "was the piece that failed"; users approve 93%→97% of prompts; 17%→5% dangerous-command block rate as prompts accumulate |
| Codex (OpenAI docs) | 2026 docs (page current) | production code, interactive | OS sandbox + approvals, two independent controls | sandbox on by default (`workspace-write`); `on-request` approvals; `auto_review` reviewer option | — | approval fatigue (stated as the reason the sandbox exists) |
| Gemini CLI (Google docs) | docs Apr 2026; product end 2026-06-18 | production code, interactive | policy engine rules + optional sandbox + trusted-folders | sandbox is **opt-in**; trusted folders **disabled by default**; `yolo` mode exists | — | untrusted-workspace "safe mode" exists precisely because auto-accept is dangerous |
| Amp (docs + notes) | 2026-08-05 / 2026-09-21 | production code | none by default; optional plugin hook (`tool.call` → allow/reject) or OPA policy server; orbs = remote machine | "By default, Amp does not ask for approval before running tools."; workspace MCP servers are the one thing that does need approval | orb burst 20, then one per 5 min; sleeping orbs cost nothing | "Taking tools away... makes the agent look for an alternative" |
| Goose (docs) | 2026 docs; AAIF 2026-04-07 | production code | mode-based autonomy, no documented sandbox | "**Autonomous Mode is applied by default**" | — | supply-chain compromise (whence the extensions malware check) |
| Crush (README + config docs) | repo @ 2026-09-27 | production code | prompt per tool call by default; `permissions allow/deny`; `--yolo` skips all prompts | "By default, Crush will ask you for permission before running tool calls."; "Be very, very careful with this feature" | — | untrusted config file (`crushrc` "is a trusted file"); the gate is delivered as a desktop notification |
| Pi (README) | fetched 2026-09-27 | production code | **none** | "no built-in permission system"; "containerize or sandbox Pi" | — | — |
| Simon Willison (practitioner) | 2025-10-22 / 2026-08-08 | mixed, incl. research | yolo + sandbox; rejects allowlists | "always use `--dangerously-skip-permissions`"; "run coding agents in a sandbox" | — | "Confirmation fatigue is real"; allowlists "inherently unreliable" |
| Armin Ronacher (practitioner) | 2025-06-12 | production code | yolo + Docker | "I disable all permission checks"; "moving your dev env into docker" | — | — |
| Steve Yegge (practitioner) | 2025-07-19 | production | yolo, then partial reversal | gave an agent GCP production access | — | "It promptly wiped a production database password and locked my network" |
| Geoffrey Huntley (practitioner) | 2025-07-14 | greenfield (new language) | **no cap on tool calls** — uncapped loop | `while :; do cat PROMPT.md \| claude-code ; done` | $297 for a contract quoted at $50k | nondeterminism ("deterministically bad"); rg-based false-negative search |
| Dex Horthy (vendor + practice) | 2025-04-03 / 2026-01-06 | production + productisation | Factor 7 pause-before-invoke (for customers); yolo by flag (own use) | "It dies in cryptic ways unless you have `--dangerously-skip-permissions`" | — | "cryptic" deaths of a loop without the flag |
| Mitchell Hashimoto (practitioner) | 2026-02-05 | production (Ghostty) | verification harness + `AGENTS.md`; no prompts discussed | "turn off agent desktop notifications"; "my job as a human to be in control of when I interrupt the agent" | — | "I would NOT allow agents to respond" (triage); agent mistakes → `AGENTS.md` rule |
| Jesse Vincent (practitioner) | 2025-10-05 / 2025-10-09 | production | git worktrees + architect/implementer review; no prompts discussed | no permission/sandbox statement found | — | "robot buddies are quite credulous"; agents accept a bad review at face value |
| Andrej Karpathy (practitioner) | 2026-02-21 | mixed | container-by-default tool selection | "runs everything in containers by default" as the attractive property | — | "sus'd to run OpenClaw" |
| Cloudflare (company) | 2026 (vinext) | production toolchain | tests + CI as the guardrail | no permission/sandbox statement in the post | 800+ sessions ≈ **$1,100**; <1 week, 1 directing engineer | "There were PRs that were just wrong" |
| Shopify (company) | 2026-03-13 / 2026-09-10 | production, flagship library | autoresearch loop + 974 tests | no permission/sandbox statement in either source | 93 commits / ≈120 experiments | — |
| StrongDM (company) | 2026-02-07 | production, greenfield | none — "without human review" | "Code must not be reviewed by humans" | "at least $1,000 on tokens today per human engineer" | unspecified; convergence is only "probabilistic and empirical" |

---

# Synthesis — what the evidence supports

## The professionals converged on "not prompts" and split on what replaces them

Across all twelve surveyed names there is not one statement of the form "I carefully approve each action." The named positions are: yolo + sandbox (Willison, Ronacher, Karpathy-by-tool-selection), yolo + Docker (Ronacher), uncapped loop (Huntley), yolo-by-flag with a harness (Horthy), harness-not-prompts (Hashimoto), process-isolation-and-review (Vincent), and one incident report from somebody who did it with production credentials (Yegge). Claude Code's own telemetry agrees with the practitioners rather than with the product's original default: 93–97% of prompts get approved.

## The industry's stated answer has moved from "gate the tool call" to "shrink the blast radius"

The strongest version of this claim comes from Anthropic's own post-mortem — allowlist gating failed where the sandbox did not ("Our custom allowlist proxy was the piece that failed") — and from OpenAI's docs, which state the ordering outright ("Changing who reviews a request doesn't expand the sandbox"). Both companies that ship a real sandbox document it as a solution to *approval fatigue*, not to a threat model. The two biggest vendors put the fix in different places: OpenAI makes the sandbox default-on and keeps a human as the reviewer of anything outside it; Claude Code makes a classifier the default and treats the sandbox as optional "defense in depth", its own setup table listing "Manual mode plus the Bash sandbox in auto-allow mode" as the way to get fewer prompts "without a classifier". The mechanisms compose technically, but each vendor sells one of them as *the* answer to prompt fatigue — and only one of them is enforced by the operating system. Claude Code's docs are explicit about which layer survives a mistake: "The operating system enforces the sandbox boundary on the running process, so it holds regardless of what the model chose to run and even if an allowed command does more than its name suggests."

## Nobody has published anything that supports rule-based gating as a durable security boundary

Allowlist-style gating exists in every product surveyed, and in every case but one it is opt-in or a non-default mode (Amp's `ask`/`allow` rules, Crush's `permissions allow`, Gemini's policy engine and its `yolo` mode). The corpus contains exactly one product whose documented default is a prompt — Crush: "By default, Crush will ask you for permission before running tool calls." — and its next paragraph hands the user `--yolo`. The negative statements are from the two sides that have measured or been burned: Willison ("I don't trust them at all"), Anthropic's own numbers on what users do with allow-rules (49.5% create them, 43% of those for interpreters, "essentially equivalent in practice" to blanket shell access), and Anthropic's decision to *drop interpreter rules from auto mode's classifiers* because they "grant arbitrary code execution".

## The 2026 default is autonomy, and it was set this year

Dates on the defaults: manual approval was Claude Code's default as of Feb 2026; auto mode became Pro/Max/Team-wide on 14 Aug 2026 and the built-in default for interactive terminal and VS Code sessions at v2.1.283; Gemini CLI ships a `yolo` mode and an opt-in sandbox; Goose ships autonomous-by-default; Amp states outright that it does not ask for approval before running tools; Pi ships no gate at all and tells you to containerise. One product points the other way — Crush, prompt-per-tool-call by default — and it is one of only two surveyed agents (with Goose) that documents no sandbox at all, so its default is a gate with nothing behind it. The direction is one-way and the sandbox is the only compensating control that either major vendor defends in writing.

## The code-execution surface is not the thing being gated, and one product gates nothing at all

Amp ships `code_exec` and states that it does not ask for approval before running tools; Claude Code's `auto` mode covers "Everything, with background safety checks"; Goose is autonomous by default; Pi ships no permission system and points at containers instead. Where an approval gate does exist in 2026 it is aimed at *configuration* (Amp's workspace MCP servers), at *interpreter rules* (Anthropic drops them from auto mode), or at *workspaces* (Gemini's trusted folders) — never at "this tool executes code" as such.

## "Company practice" is not one thing, even inside a single company

OpenAI's own two engineering posts describe opposite postures (seven parallel ungated Codex CLIs vs "Wait for me to review and approve the plan before beginning"). Cloudflare's and Shopify's write-ups describe no permission regime at all and put all their guardrail language on tests, CI, and mechanical verification. StrongDM deleted the human entirely and replaced boolean success with a probabilistic metric. The honest reading: at the organization level, the *verification* layer (tests, CI, replicated environments) is what companies actually invest in and publish; the *permission* layer is largely a vendor-docs topic.

## The strongest cost figure in the corpus is small, and the strongest autonomy claim is the least evidenced

Cloudflare's is the only company figure with both token cost and scale ($1,100 / 800+ sessions) and it produced "PRs that were just wrong". Huntley's $297/$50k and StrongDM's "$1,000/day/engineer" are self-reported and unverifiable. Conversely the largest claims of autonomy — StrongDM's dark factory, Shopify's CEO-authored 974-test PR — have no published approval, sandbox, or review policy behind them at all.

---

# Thin evidence, missing evidence, and "no precedent found"

**Thin.**
1. Non-vendor approval-fatigue evidence. The best number (1,053 testers; 17%→5% block rate) is *vendor-run and vendor-published* by Anthropic. Independent items are Willison's "Confirmation fatigue is real" and Hashimoto's "turn off agent desktop notifications" — neither measured. One Anthropic-cited input (a Reddit thread) is **not reachable**, see below.
2. What practitioners do when they are *not* writing a blog post. Every practitioner position here is self-reported; none is audited, and all of the yolo accounts predate or straddle the Dec-2025 capability step that Karpathy dates ("basically didn't work before December").
3. What any of these people do about *secrets and credentials* specifically. Pi's README names credential access as out of scope; nobody else's published practice separates credential use from shell access. StrongDM's "Digital Twin Universe" is the only published attempt to remove production from the blast radius at all.

**Missing.**
4. Failure/damage statistics from any vendor. Yegge's wiped database password is the only concrete blast-radius incident in the corpus, and it is anecdote. Anthropic's "6.3% of manually approved sessions contained a harmful action" is the only session-level harm rate published by anyone, and it measures a *simulated* harmful command in a study, not real damage.
5. Any statement of Google's internal approval/sandbox policy. The 40K-SWE claim is contested and unaccompanied by a policy.
6. Anything from Kent Beck this session.

**No precedent found (searched, nothing exists to cite).**
- A named practitioner who describes carefully approving each action as their deliberate day-to-day practice. **Zero found.**
- A named practitioner defending command-pattern allowlists as a security boundary. **Zero found** — only the reverse (Willison, Anthropic's classifier design).
- Any published internal policy from OpenAI, Google, Cloudflare, or Shopify describing which approval mode its engineers run. The internal posts describe *workflows*, never *policies*.
- A practitioner account of *giving up* a sandbox for prompts (the reverse migration). **Zero found** — every migration described runs from prompts toward either yolo-with-isolation or an LLM classifier.

---

# Not verified

1. **`--yolo` as a CLI flag for Gemini CLI.** The policy-engine page names `yolo` only as an approval *mode*. The configuration reference was not confirmed, so no flag is asserted here.
2. **StrongDM's primary page.** `https://factory.strongdm.ai` returned only an RSS shell; every StrongDM quote above is TRANSCRIBED from Simon Willison's page, with the primary blamed on JS rendering. Their `$1,000/day` claim is unverified verbatim.
3. **Goose and any sandbox.** No sandbox is documented on the permission pages fetched; that is an absence of evidence, not evidence of absence.
4. **Pi's `containerization.md` contents.** The README names three patterns (Gondolin, plain Docker, OpenShell); the doc itself was not read.
5. **antirez's position** on permissions/sandboxing. `antirez.com/news/154`, `/news/158`, `/news/164` and one HN thread checked; **no statement found**.
6. **Thorsten Ball's position.** No gating statement found in his archive; "Ownership" (8 Jul 2026) is an Amp internal note whose contents were not read.
7. **Kent Beck.** Not surveyed this session.
8. **Twitter/X posts quoted via Simon Willison's tag pages** (Willison 2025-10-22, Ronacher 2025-06-12, Yegge 2025-07-19, Karpathy 2026-02-21, Osmani 2026-04-13). The tweets themselves were not fetched; the tag pages reproduce them verbatim with links.
9. **The Reddit thread Anthropic cites for approval fatigue.** `https://www.reddit.com/r/ClaudeAI/comments/1rru8zw/` returned a JS shell containing only an inline SVG logo, zero post text. **Not reachable, not absent.**
10. **Anthropic's cited Apollo Research approval-fatigue pilot.** The current Apollo blog index does not show a post identifiable as that pilot; it may be a different publication channel.
11. **Shopify's internal approval policy.** Publicly attributed work (the CEO's Liquid PR, the River agent's Slack-only confinement) is verified; the policy behind them is not published.
12. **Cloudflare's per-session cost breakdown** and whether a human reviewed the "PRs that were just wrong". Not published.
13. **Whether Google's geminicli.com docs still reflect a supported product** for the enterprise tier after the 18 Jun 2026 Antigravity transition. The banner persists; the enterprise carve-out is quoted but the docs' post-transition maintenance state was not verified.

14. **Which Gemini CLI policy-engine tier numbering is authoritative.** The page's tier table says "Default 1 / Extension 2 / Workspace 3 **(Currently disabled)** / User 4 / Admin 5", while the worked examples directly below compute "A `priority: 10` rule in a Workspace policy TOML becomes `2.010`. A `priority: 100` rule in a User policy TOML becomes `3.100`." Both are reproduced; the discrepancy is in the vendor's own page and was not resolved.
15. **Version drift in the Claude Code answers.** The quoted defaults are stated by the docs for v2.1.283 or later; on earlier builds the built-in starting mode was Manual, and before 14 Aug 2026 auto mode applied to Pro/Max/Team plans only. Any deployment pinned to an older build should read the version guards inside those quotes literally.

*Every URL in this document was fetched during the 2026-09-27 session unless marked TRANSCRIBED or listed as unreachable. No trained-knowledge defaults, flag names, or setting names were used.*
